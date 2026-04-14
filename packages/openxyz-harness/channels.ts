import { join } from "node:path";
import type { Thread as ChatThread, Message as ChatMessage, Adapter as ChatAdapter } from "chat";

export type Summary = {
  text: string;
  upToMessageId: string;
};

export type Thread = ChatThread<{
  summary?: Summary;
}>;

export type Message = ChatMessage;

export type FilterFn = (thread: Thread, message: Message) => boolean | Promise<boolean>;

/**
 * Representation of a channel file within the OpenXyz harness.
 */
export type ChannelFile = {
  agent: string;
  adapter: ChatAdapter;
  filter: FilterFn;
};

export async function scanChannels(cwd: string): Promise<Record<string, ChannelFile>> {
  // TODO(agent): support .js and .ts
  const glob = new Bun.Glob("channels/[!_]*.ts");
  const channels: Record<string, ChannelFile> = {};

  for await (const path of glob.scan({ cwd })) {
    const file = path.split("/").pop()!;
    const name = file.replace(/\.ts$/, "");
    const mod = await import(join(cwd, path));

    if (!mod.default) {
      console.warn(`[openxyz] channels/${file} has no default export, skipping`);
      continue;
    }

    let filter: FilterFn = () => true;
    if (mod.filter) {
      if (typeof mod.filter !== "function") {
        throw new Error(`[openxyz] channels/${file} filter export is not a function`);
      }

      filter = mod.filter as FilterFn;
    } else {
      console.warn(`[openxyz] channels/${file} has no filter export, using default filter that always returns true`);
    }

    channels[name] = {
      agent: mod.agent ?? "general",
      adapter: mod.default,
      filter,
    };
  }

  return channels;
}
