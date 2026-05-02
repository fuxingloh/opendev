import { createTelegramAdapter, type TelegramAdapterConfig, type TelegramRawMessage } from "@chat-adapter/telegram";
import {
  type AiMessage,
  type AiMessagePart,
  isTableNode,
  type Message,
  parseMarkdown,
  stringifyMarkdown,
  toAiMessages,
} from "chat";
import type { MdastTable, Root } from "chat";
import type { Adapter as ChatSdkAdapter } from "chat";
import type { ModelMessage, SystemModelMessage } from "ai";
import { Channel, Session, type ReplyAction, type Thread } from "@openxyz/runtime/channels";
import { platform } from "@openxyz/runtime/platform";
import { renderTablePng } from "./render-table";
import { splitOnFinishStep } from "./split-stream";

export type { Thread, Message, ReplyAction } from "@openxyz/runtime/channels";
export { Channel } from "@openxyz/runtime/channels";

export type TelegramConfig = TelegramAdapterConfig & {
  botToken: string;
  /**
   * When `true`, each Telegram forum topic (chat-sdk "thread") gets its own
   * session log. When `false` (default), every topic inside a supergroup
   * shares one session — the chief-of-staff model where the assistant
   * remembers across topics in the same room. Irrelevant in DMs, where
   * thread and channel are effectively the same scope.
   */
  threaded?: boolean;
};

/**
 * Concrete Telegram `Channel`. Templates typically subclass this and
 * override `reply()` (and optionally `filter()`), then `export default new
 * SubclassName(opts)`. Call `super.reply(thread, message)` to defer to this
 * class's default dispatch once your gate checks pass.
 */
export class TelegramChannel extends Channel<TelegramRaw> {
  readonly adapter: ChatSdkAdapter;
  readonly #threaded: boolean;
  readonly #botToken: string;

  constructor(opts: TelegramConfig) {
    super();
    this.#threaded = opts.threaded ?? false;
    this.#botToken = opts.botToken;
    // On any serverless platform (Vercel, Cloudflare), polling would block
    // forever and bleed connections. Require webhook mode; the user runs
    // Telegram's `setWebhook` once, pointing at `https://<deploy>/api/webhooks/telegram`.
    // The adapter verifies the incoming request via TELEGRAM_WEBHOOK_SECRET_TOKEN
    // (or `secretToken` in opts) — set it or requests run unverified.
    const isDeployed = platform() === "vercel" || platform() === "cloudflare";
    const mode: TelegramAdapterConfig["mode"] = isDeployed ? "webhook" : "polling";
    this.adapter = createTelegramAdapter({ ...opts, mode });
  }

  override async getSession(thread: Thread): Promise<Session> {
    // Default `threaded: false` → channel-scoped. Supergroups with forum
    // topics pool every topic into one session, so the assistant keeps a
    // single running memory across the whole group. Flip to `threaded: true`
    // for strict per-topic sessions. DMs collapse the distinction either way.
    return new Session(thread, this.#threaded ? "thread" : "channel");
  }

  async toModelMessages(thread: Thread, messages: Message<TelegramRaw>[]): Promise<ModelMessage[]> {
    // History is owned by the session now (mnemonic/081). Per-message mapping
    // preserves Telegram's reply/forward XML annotation so the agent sees
    // conversation structure, not just flat text.
    const botUserId = (this.adapter as { botUserId?: string }).botUserId;

    // mnemonic/143 — chat-sdk's `toAiMessages` filters out messages with
    // empty `text.trim()` (`ai.ts:185`), even when they carry attachments.
    // For an attachment-only reply (e.g. user photo-replies to the bot
    // without a caption) the burst becomes empty after conversion →
    // `session.append([])` is a no-op → the prompt ends with the previous
    // assistant turn → Bedrock Sonnet 4.6 returns 400 ValidationException
    // "This model does not support assistant message prefill". Inject a
    // descriptive placeholder so the filter keeps the message and the
    // image part flows through. Remove once chat-sdk's filter learns to
    // keep attachment-only messages (still unfixed in `chat@4.27.0`).
    for (const msg of messages) {
      const atts = msg.attachments ?? [];
      if (atts.length === 0 || msg.text.trim()) continue;
      const summary = atts.map((a) => `[attached ${a.type}]`).join(" ");
      (msg as { text: string }).text = summary || "[attachment]";
    }

    const result = await toAiMessages(messages, {
      includeNames: !thread.isDM,
      transformMessage: (aiMsg, src) => annotate(aiMsg, src, botUserId),
    });
    return result as ModelMessage[];
  }

  async getSystemMessage(thread: Thread): Promise<SystemModelMessage> {
    return {
      role: "system",
      content: thread.isDM ? `Telegram DM: ${thread.channel.name}` : `Telegram Group: ${thread.channel.name}`,
    };
  }

  /**
   * Telegram's `dateSent` is 1s-resolution (Bot API delivers Unix seconds),
   * so a forwarded burst typically ties on timestamp. The per-chat
   * `message_id` (numeric tail of `chat:msgid` like `7601560926:14`) is
   * monotonic and authoritative for send order — extract and use as
   * tiebreaker. Lexical id sort would mis-order `:9` vs `:14`, hence the
   * numeric extraction.
   */
  override sortMessages(messages: Message<TelegramRaw>[]): Message<TelegramRaw>[] {
    return [...messages].sort((a, b) => {
      const t = a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
      if (t !== 0) return t;
      return idTail(a.id) - idTail(b.id);
    });
  }

  /**
   * Telegram-specific stream rendering. Three things stacked, all
   * Telegram-shaped, none belonging in runtime:
   *
   * 1. **Bubble split (mnemonic/104).** Iterate `splitOnFinishStep` so each
   *    LLM step posts as its own chat bubble — natural "ack → tool →
   *    result" rhythm.
   * 2. **Table → PNG (mnemonic/115).** Buffer each substream, walk mdast,
   *    render `Table` nodes as inline images via `@resvg/resvg-js`. Replaces
   *    the unreadable `tableToAscii` fallback in
   *    `../chat/packages/adapter-telegram/src/markdown.ts`. The whole table
   *    is captured before render — `collectTextDeltas` drains the
   *    substream first, so we render once on the final mdast, never on a
   *    partial.
   * 3. **Typing heartbeat (mnemonic/100).** Re-fire `startTyping` between
   *    bubbles so Telegram's 5s `sendChatAction` TTL doesn't lapse during
   *    tool execution.
   *
   * Streaming trade-off: intra-bubble streaming is lost on Telegram. Edit-
   * message UX was already weak (rate-limited, mobile flash) so the
   * regression is invisible in practice.
   */
  override async postFullStream(thread: Thread, fullStream: AsyncIterable<unknown>): Promise<void> {
    for await (const subStream of splitOnFinishStep(fullStream as AsyncIterable<{ type: string }>)) {
      const text = await collectTextDeltas(subStream);
      if (!text) continue;

      // mnemonic/128: investigating `<null>` bubbles seen in Telegram. Log
      // suspicious short outputs so we can confirm whether the model emitted
      // the literal text or it's a round-trip artifact. Drop the log once the
      // root cause is identified.
      if (text.length < 32 || /^<\w+>$/.test(text.trim())) {
        console.warn("[openxyz/telegram] mnemonic/128 — suspicious bubble text", { text, length: text.length });
      }

      const ast = safeParseMarkdown(text);
      const segments = ast ? splitTablesFromAst(ast) : [{ kind: "md" as const, text }];

      if (segments.length === 1 && segments[0]!.kind === "md") {
        await thread.post({ markdown: segments[0]!.text });
      } else {
        for (const seg of segments) {
          if (seg.kind === "md") {
            if (seg.text) await thread.post({ markdown: seg.text });
            continue;
          }
          try {
            const png = await renderTablePng(seg.node);
            await this.#sendPhoto(thread.id, png);
          } catch (err) {
            // Resvg load / native binding failure or sendPhoto rejection →
            // fall through to mdast post so the table at least renders via
            // chat-sdk's ASCII fallback. Logging only — never break a turn
            // over the stop-gap.
            console.warn("[openxyz/telegram] table PNG render failed, falling back to ASCII", err);
            await thread.post({ ast: { type: "root", children: [seg.node] } as Root });
          }
        }
      }

      await thread.startTyping().catch(() => {});
    }
  }

  /**
   * Direct Bot API `sendPhoto` call. Bypasses chat-sdk because the adapter
   * routes every `FileUpload` through `sendDocument` (`../chat/packages/
   * adapter-telegram/src/index.ts:683`), which renders as a tap-to-download
   * attachment with no inline preview — the opposite of what we want for a
   * table image. `sendPhoto` shows a real chat bubble image. Bypass loses
   * chat-sdk's lock extension + `messageCache` insertion for this one
   * outbound message; acceptable since the text bubbles either side still
   * go through `thread.post`. Decode `thread.id` (`telegram:<chatId>` or
   * `telegram:<chatId>:<threadId>`) directly — `decodeThreadId` is public
   * on the adapter but typing it across the chat-sdk boundary is more
   * surface area than the split. Stop-gap (mnemonic/115) — proper fix is
   * an upstream patch routing image MIME types in chat-sdk's adapter.
   */
  async #sendPhoto(threadId: string, png: Buffer): Promise<void> {
    const parts = threadId.split(":");
    if (parts[0] !== "telegram" || parts.length < 2) {
      throw new Error(`unexpected telegram threadId shape: ${threadId}`);
    }
    const chatId = parts[1]!;
    const messageThreadId = parts.length === 3 ? parts[2] : undefined;

    const form = new FormData();
    form.append("chat_id", chatId);
    if (messageThreadId) form.append("message_thread_id", messageThreadId);
    form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "table.png");

    const res = await fetch(`https://api.telegram.org/bot${this.#botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      throw new Error(`telegram sendPhoto failed: ${res.status} ${body}`);
    }
  }

  /**
   * Default dispatch: respond to DMs, respond in groups only when @-mentioned
   * or replied-to. Templates with allowlists typically check the allowlist
   * first and then `return super.reply(thread, message)` to reuse this.
   */
  async reply(thread: Thread, message: Message<TelegramRaw>): Promise<ReplyAction> {
    if (thread.isDM) return { reply: true };
    if (message.isMention || isReplyToBot(thread, message)) {
      return { reply: true, reaction: "👀" };
    }
    return { reply: false };
  }
}

/**
 * Upstream `TelegramRawMessage` omits reply/forward/quote fields. Extend here
 * with the subset we annotate against. See https://core.telegram.org/bots/api#message.
 */
export type TelegramRaw = TelegramRawMessage & {
  reply_to_message?: TelegramRawMessage & {
    text?: string;
    caption?: string;
    from?: TelegramUser;
    sender_chat?: TelegramChat;
  };
  /** Set when the user selected a portion of the replied-to message to quote. */
  quote?: { text: string; is_manual?: boolean };
  /** Telegram Bot API 7.0+ unified forward metadata. */
  forward_origin?: TelegramForwardOrigin;
  /** Legacy forward fields (still populated alongside forward_origin). */
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_sender_name?: string;
  is_automatic_forward?: boolean;
};

interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}

interface TelegramChat {
  id?: number;
  title?: string;
  username?: string;
}

type TelegramForwardOrigin =
  | { type: "user"; sender_user: TelegramUser }
  | { type: "hidden_user"; sender_user_name: string }
  | { type: "chat"; sender_chat: TelegramChat; author_signature?: string }
  | { type: "channel"; chat: TelegramChat; message_id: number; author_signature?: string };

/**
 * Extract the trailing numeric segment of a Telegram message id for the
 * burst-sort tiebreaker. Ids look like `7601560926:14`; the suffix is the
 * per-chat `message_id` and is monotonic. Falls back to `0` for any id that
 * doesn't end in digits — in practice every Telegram id does.
 */
function idTail(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function annotate(aiMsg: AiMessage, src: Message, botUserId: string | undefined): AiMessage {
  const raw = src.raw as TelegramRaw | undefined;
  if (!raw) return aiMsg;

  const blocks: string[] = [];

  const reply = buildReply(raw, botUserId);
  if (reply) blocks.push(reply);

  const forward = buildForward(raw);
  if (forward) blocks.push(forward);

  if (blocks.length === 0) return aiMsg;

  const prefix = blocks.join("\n\n") + "\n\n";
  return prependText(aiMsg, prefix);
}

function buildReply(raw: TelegramRaw, botUserId: string | undefined): string | null {
  const reply = raw.reply_to_message;
  if (!reply) return null;

  const quoted = raw.quote?.text ?? reply.text ?? reply.caption;
  if (!quoted) return null;

  const replyingToBot = isBotUser(reply.from, botUserId);
  const author = replyingToBot
    ? "assistant"
    : (userDisplayName(reply.from) ?? chatDisplayName(reply.sender_chat) ?? "user");

  return `<reply_to author="${escapeAttr(author)}">\n${quoted}\n</reply_to>`;
}

function buildForward(raw: TelegramRaw): string | null {
  const from = forwardFrom(raw);
  if (!from) return null;
  return `<forwarded from="${escapeAttr(from)}" />`;
}

function forwardFrom(raw: TelegramRaw): string | null {
  const origin = raw.forward_origin;
  if (origin) {
    switch (origin.type) {
      case "user":
        return userDisplayName(origin.sender_user);
      case "hidden_user":
        return origin.sender_user_name;
      case "chat":
        return chatDisplayName(origin.sender_chat);
      case "channel":
        return chatDisplayName(origin.chat);
    }
  }

  return userDisplayName(raw.forward_from) ?? chatDisplayName(raw.forward_from_chat) ?? raw.forward_sender_name ?? null;
}

/**
 * True when the message is a reply to one of our bot's earlier messages.
 * Reads `raw.reply_to_message.from.id` against the adapter's `botUserId`
 * (populated after `adapter.initialize()` → `getMe()`).
 */
export function isReplyToBot(thread: Thread, message: Message<TelegramRaw>): boolean {
  const botUserId = (thread.adapter as { botUserId?: string }).botUserId;
  const raw = message.raw;
  if (!raw?.reply_to_message || !botUserId) return false;
  return isBotUser(raw.reply_to_message.from, botUserId);
}

function isBotUser(user: TelegramUser | undefined, botUserId: string | undefined): boolean {
  return !!user?.id && !!botUserId && String(user.id) === botUserId;
}

function userDisplayName(user: TelegramUser | undefined): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return full || user.username || null;
}

function chatDisplayName(chat: TelegramChat | undefined): string | null {
  if (!chat) return null;
  return chat.title ?? chat.username ?? null;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function prependText(aiMsg: AiMessage, prefix: string): AiMessage {
  // AiAssistantMessage is always string; only AiUserMessage can hold parts.
  if (aiMsg.role === "assistant" || typeof aiMsg.content === "string") {
    return { ...aiMsg, content: prefix + (aiMsg.content as string) };
  }
  const parts = aiMsg.content;
  const textIdx = parts.findIndex((p) => p.type === "text");
  if (textIdx >= 0) {
    const next: AiMessagePart[] = parts.map((p, i) =>
      i === textIdx && p.type === "text" ? { ...p, text: prefix + p.text } : p,
    );
    return { role: "user", content: next };
  }
  // No text part (pure attachments) — inject one up front.
  return { role: "user", content: [{ type: "text", text: prefix.trimEnd() }, ...parts] };
}

/**
 * Drain an AI SDK fullStream-shaped substream and concatenate every
 * `text-delta` payload into a single string. Non-text events (`start-step`,
 * `tool-input-start`, etc.) are ignored — chat-sdk's `fromFullStream`
 * already drops them, so we mirror that behavior. Handles both AI SDK v5
 * (`textDelta`) and v6 (`text`/`delta`) field shapes.
 */
async function collectTextDeltas(stream: AsyncIterable<unknown>): Promise<string> {
  let out = "";
  for await (const event of stream) {
    if (typeof event === "string") {
      out += event;
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const e = event as { type?: string; text?: unknown; delta?: unknown; textDelta?: unknown };
    if (e.type !== "text-delta") continue;
    const value = e.text ?? e.delta ?? e.textDelta;
    if (typeof value === "string") out += value;
  }
  return out;
}

type Segment = { kind: "md"; text: string } | { kind: "table"; node: MdastTable };

/**
 * Walk top-level mdast children, peeling `Table` nodes out into their own
 * segments and stringifying everything else back into markdown chunks.
 * Each `Table` becomes its own bubble (rendered as PNG); contiguous
 * non-table content stays as one markdown bubble. Empty groups (consecutive
 * tables with no prose between) are dropped.
 */
function splitTablesFromAst(root: Root): Segment[] {
  const segments: Segment[] = [];
  let buf: Root["children"] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const md = stringifyMarkdown({ type: "root", children: buf } as Root).trim();
    if (md) segments.push({ kind: "md", text: md });
    buf = [];
  };
  for (const child of root.children) {
    if (isTableNode(child)) {
      flush();
      segments.push({ kind: "table", node: child });
    } else {
      buf.push(child);
    }
  }
  flush();
  return segments;
}

function safeParseMarkdown(text: string): Root | null {
  try {
    return parseMarkdown(text);
  } catch (err) {
    console.warn("[openxyz/telegram] markdown parse failed, posting raw", err);
    return null;
  }
}
