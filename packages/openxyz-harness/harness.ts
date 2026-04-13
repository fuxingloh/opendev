import { Chat, toAiMessages } from "chat";
import type { Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { scanChannels, type ChannelEntry } from "./channels";
import { AgentFactory } from "./agents/factory";

export class OpenXyzHarness {
  readonly cwd: string;
  #chat?: Chat;
  #factory?: AgentFactory;
  #channels: Record<string, ChannelEntry> = {};

  constructor(opts: { cwd: string }) {
    this.cwd = opts.cwd;
  }

  async start(): Promise<void> {
    const factory = new AgentFactory(this.cwd);
    const [, channels] = await Promise.all([factory.init(), this.#loadChannels()]);

    // Validate: every channel references an agent that exists
    for (const [name, entry] of Object.entries(channels)) {
      if (!factory.defs[entry.agent]) {
        throw new Error(`[openxyz] channel "${name}" references agent "${entry.agent}" but no such agent exists`);
      }
    }

    this.#factory = factory;
    this.#channels = channels;

    const adapters = Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.adapter]));
    const chat = new Chat({
      adapters: adapters as Record<string, never>,
      state: createMemoryState(),
      userName: "openxyz",
      logger: "silent",
      fallbackStreamingPlaceholderText: null,
    });
    this.#chat = chat;

    // fire-and-forget — awaiting here holds the chat-sdk thread lock and causes LockError on concurrent messages (working/004)
    chat.onDirectMessage((thread) => {
      this.#reply(thread).catch((err) => console.error("[openxyz] handler error", err));
    });

    chat.onSubscribedMessage((thread) => {
      this.#reply(thread).catch((err) => console.error("[openxyz] handler error", err));
    });

    // initialize() auto-starts polling for adapters in "auto" mode when no webhook is configured.
    await chat.initialize();
  }

  async #loadChannels() {
    const channels = await scanChannels(this.cwd);
    if (Object.keys(channels).length === 0) {
      throw new Error("[openxyz] no channels found under channels/*.ts — nothing to run");
    }
    return channels;
  }

  async #reply(thread: Thread): Promise<void> {
    const [id, userId] = thread.id.split(":") as [string, string];
    const channel = this.#channels[id];
    if (!channel) return;
    if (channel.allowlist && !channel.allowlist.has(userId)) return;

    const agent = await this.#factory!.create(channel.agent);

    // TODO: subscribe() is idempotent but called on every reply — redundant after first contact.
    await thread.subscribe();
    await thread.startTyping();
    const fetched = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
    // Inject reply context — chat-sdk flattens messages and drops reply-to relationships.
    //  Telegram surfaces it via message.raw.reply_to_message. Other platforms TBD.
    for (const msg of fetched.messages) {
      const raw = msg.raw as { reply_to_message?: { text?: string; from?: { is_bot?: boolean } } } | undefined;
      const parent = raw?.reply_to_message?.text;
      if (!parent) continue;
      const author = raw?.reply_to_message?.from?.is_bot ? "assistant" : "user";
      msg.text = `<reply_to author="${author}">\n${parent}\n</reply_to>\n\n${msg.text}`;
    }
    const history = await toAiMessages(fetched.messages);
    const env = {
      role: "system" as const,
      content: `Current date: ${new Date().toISOString().split("T")[0]}`,
    };
    const result = await agent.stream({ prompt: [env, ...history] });
    await thread.post(result.fullStream);
  }

  async stop(): Promise<void> {
    await this.#chat?.shutdown();
  }
}
