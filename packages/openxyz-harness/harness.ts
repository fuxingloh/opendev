import { Chat, toAiMessages } from "chat";
import type { Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { scanChannels } from "./channels";
import { Filesystem } from "./tools/filesystem";
import { web_fetch, web_search } from "./tools/web";
import { scanSkills, createSkillTool } from "./tools/skill";
import { scanTools } from "./tools/custom";
import { create as createAgent } from "./agents/main.ts";

export class OpenXyzHarness {
  readonly cwd: string;
  #agent?: ReturnType<typeof createAgent>;
  #chat?: Chat;
  #allowlists: Record<string, Set<string>> = {};

  constructor(opts: { cwd: string }) {
    this.cwd = opts.cwd;
  }

  async #getTools() {
    const fs = new Filesystem(this.cwd);
    const [skills, custom] = await Promise.all([scanSkills(this.cwd), scanTools(this.cwd)]);

    return {
      ...fs.tools(),
      web_fetch,
      web_search,
      skill: createSkillTool(skills),
      ...custom,
    };
  }

  async start(): Promise<void> {
    const [tools, { adapters, allowlists }] = await Promise.all([this.#getTools(), scanChannels(this.cwd)]);
    this.#agent = createAgent(tools);
    this.#allowlists = allowlists;
    if (Object.keys(adapters).length === 0) {
      // Fail fast: without at least one channel, the harness has no way to receive messages. See working/027.
      throw new Error("[openxyz] no channels found under channels/*.ts — nothing to run");
    }

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

  async stop(): Promise<void> {
    await this.#chat?.shutdown();
  }

  async #reply(thread: Thread): Promise<void> {
    // Allowlist check: thread.id is "channel:user_id", match against the channel's allowlist
    const [channel, userId] = thread.id.split(":");
    const allowed = this.#allowlists[channel];
    if (allowed && !allowed.has(userId)) return;

    await thread.subscribe();
    await thread.startTyping();
    const fetched = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
    const history = await toAiMessages(fetched.messages);
    const result = await this.#agent!.stream({ prompt: history });
    try {
      await thread.post(result.fullStream);
    } catch {
      // TODO: chat-sdk's Telegram adapter doesn't escape MarkdownV2 entities properly.
      //  Fall back to plain text (no parse_mode) until upstream fixes it.
      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
      }
      await thread.post(text);
    }
  }
}
