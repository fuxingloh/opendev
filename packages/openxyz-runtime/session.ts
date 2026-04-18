import type { ModelMessage } from "ai";
import type { Thread } from "./channels";

/**
 * Session = the agent's view of the conversation (full `ModelMessage[]`
 * including tool calls, tool results, and reasoning blocks). Distinct from
 * the chat-sdk thread, which only stores what got rendered to the user.
 *
 * Persistence piggy-backs on chat-sdk's `thread.state` — whichever adapter
 * the user picked (memory, Redis, PGlite, Postgres) stores the session log
 * alongside thread metadata. No parallel store, no parallel TTL.
 *
 * V1 maps 1:1 with the thread. Cross-channel identity stitching (same user
 * across Telegram + terminal) is a later problem — the shape here stays the
 * same, `Session` just stops being tied to a single thread. See mnemonic/081.
 */
export class Session {
  readonly #thread: Thread;

  constructor(thread: Thread) {
    this.#thread = thread;
  }

  get id(): string {
    return this.#thread.id;
  }

  async messages(): Promise<ModelMessage[]> {
    const state = await this.#thread.state;
    return state?.session ?? [];
  }

  async append(messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const existing = await this.messages();
    await this.#thread.setState({ session: [...existing, ...messages] });
  }
}
