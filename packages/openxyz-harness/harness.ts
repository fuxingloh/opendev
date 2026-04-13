import { Chat, toAiMessages } from "chat";
import type { Thread, Message } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { scanChannels, type ChannelEntry, type MessageContext, type ThreadState } from "./channels";
import { AgentFactory } from "./agents/factory";

/**
 * Provider error messages aren't typed — detect context-overflow by regex on
 * the error text. Matches OpenAI ("context_length_exceeded", "maximum context
 * length"), Anthropic ("prompt is too long"), and generic phrasings.
 */
function isContextOverflow(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /context[_ ]?(length|window)|token limit|prompt is too long|exceeds?.*context|too many tokens/.test(msg);
}

export class OpenXyzHarness {
  readonly cwd: string;
  readonly agentFactory: AgentFactory;
  #chat?: Chat;
  #channels: Record<string, ChannelEntry> = {};

  constructor(opts: { cwd: string }) {
    this.cwd = opts.cwd;
    this.agentFactory = new AgentFactory(this.cwd);
  }

  async start(): Promise<void> {
    const [, channels] = await Promise.all([this.agentFactory.init(), scanChannels(this.cwd)]);
    this.#channels = channels;
    if (Object.keys(channels).length === 0) {
      throw new Error("[openxyz] no channels found under channels/*.ts — nothing to run");
    }

    // Validate: every channel references an agent that exists
    for (const [name, entry] of Object.entries(channels)) {
      if (!this.agentFactory.defs[entry.agent]) {
        throw new Error(`[openxyz] channel "${name}" references agent "${entry.agent}" but no such agent exists`);
      }
    }

    const chat = new Chat({
      adapters: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.adapter])) as Record<string, never>,
      state: createMemoryState(),
      userName: "openxyz",
      logger: "silent",
      fallbackStreamingPlaceholderText: null,
    });

    // fire-and-forget — awaiting here holds the chat-sdk thread lock and causes LockError on concurrent messages (working/004)
    chat.onDirectMessage((thread, message, channel) => {
      this.#reply({ thread, message, channel }).catch((err) => console.error("[openxyz] handler error", err));
    });

    chat.onSubscribedMessage((thread, message) => {
      this.#reply({ thread, message }).catch((err) => console.error("[openxyz] handler error", err));
    });

    // initialize() auto-starts polling for adapters in "auto" mode when no webhook is configured.
    await chat.initialize();
    this.#chat = chat;
  }

  async #reply(ctx: MessageContext): Promise<void> {
    const thread = ctx.thread;
    const cfg = this.#channels[thread.adapter.name];
    if (!cfg) {
      throw new Error(`[openxyz] no channel config found for adapter "${thread.adapter.name}"`);
    }

    if (cfg.shouldRespond && !(await cfg.shouldRespond(ctx))) return;
    // TODO: subscribe() is idempotent but called on every reply — redundant after first contact.
    await thread.subscribe();

    const agent = await this.agentFactory.create(cfg.agent);
    await thread.startTyping();

    let { summary, recent } = await this.#loadContext(thread);

    const env = {
      role: "system" as const,
      content: `Current date: ${new Date().toISOString().split("T")[0]}`,
    };
    const runStream = async () => {
      const history = await toAiMessages(recent);
      const summaryMsg = summary?.text
        ? {
            role: "system" as const,
            content: `<previous_conversation_summary>\n${summary.text}\n</previous_conversation_summary>`,
          }
        : null;
      const prompt = summaryMsg ? [env, summaryMsg, ...history] : [env, ...history];
      const result = await agent.stream({ prompt });
      await thread.post(result.fullStream);
    };

    try {
      await runStream();
    } catch (err) {
      if (!isContextOverflow(err)) throw err;
      // Reactive fallback: proactive threshold missed (reasoning tokens, tool-output
      // growth, provider overhead). Force-compact what we have and retry once. A
      // second overflow bubbles to the handler's catch.
      console.warn("[openxyz] context overflow — forcing reactive compaction");
      summary = await this.#compact(thread);
      ({ recent } = await this.#loadContext(thread));
      await runStream();
    }
  }

  /**
   * Invoke the compaction agent on a thread's current history. Self-contained:
   * reads prior summary + recent messages from thread state/platform, merges with
   * the prior summary (so context isn't lost across compactions), writes the new
   * summary back. Posts a "Compacting..." placeholder, deleted on success so the
   * user sees progress even if the process dies mid-compaction.
   */
  async #compact(thread: Thread<ThreadState>) {
    const { summary: prior, recent } = await this.#loadContext(thread);
    const lastMessage = recent[recent.length - 1];
    if (!lastMessage) {
      return;
    }

    const placeholder = await thread.post("Compacting...");
    const compactor = await this.agentFactory.create("compact", { delegate: false });
    const history = await toAiMessages(toCompact);
    const prompt = prior
      ? [
          {
            role: "system" as const,
            content: `<previous_summary>\n${prior.text}\n</previous_summary>\n\nMerge the previous summary above with the new messages below into a single updated summary.`,
          },
          ...history,
        ]
      : history;

    const result = await compactor.generate({ prompt });
    const summary = {
      text: result.text,
      upToMessageId: lastMessage.id,
    };
    await thread.setState({ summary: summary });
    await placeholder.delete();
    return summary;
  }

  /**
   * Load thread state + recent messages (newest first via `thread.messages`, cropped
   * at the summary boundary). Common to `#reply` and `#compact`; prompt assembly
   * diverges from there.
   */
  async #loadContext(thread: Thread<ThreadState>) {
    const state = (await thread.state) ?? {};
    const summary = state.summary;
    const recent: Message[] = [];
    for await (const msg of thread.messages) {
      if (summary && msg.id <= summary.upToMessageId) break;
      recent.unshift(msg);
      // Collect 100 messages (only) need a better design later on.
      // Cap on how far back we walk thread.messages when searching for the summary
      // boundary. Beyond this, auto-compaction (periodic refresh, memory module) is the
      // better mechanism — see working/054.
      if (recent.length >= 100) break;
    }
    return { summary, recent };
  }

  async stop(): Promise<void> {
    await this.#chat?.shutdown();
  }
}
