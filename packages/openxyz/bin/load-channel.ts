import { Channel, type MessageFilter, type ReplyFunc } from "@openxyz/runtime/channels";

/**
 * Validate and return the default-exported `Channel` instance from a channel
 * module, applying any sibling `filter`/`reply` exports on top. Template
 * glue — `openxyz start` calls this after dynamic-import, `openxyz build`
 * code-gens a call into the bundled entrypoint. Lives in the facade because
 * the two-style convention (subclass vs sibling-exports) is a template
 * contract, not a runtime primitive.
 *
 * Two template styles are supported and can be mixed:
 * 1. **Subclass** — define `class MyX extends TelegramChannel` and override
 *    `filter`/`reply`/... in the class. `export default new MyX(...)`.
 *    Can use `super.reply(...)` / `this` to compose with the parent class.
 * 2. **Sibling exports** — `export default new TelegramChannel(...)` plus
 *    `export function filter(...)` / `export function reply(...)`. The
 *    sibling `reply` can return `boolean` (true → default, false → silent)
 *    or a full `ReplyAction` object.
 *    Siblings are plain module functions, **not** class methods — no `this`,
 *    no `super`. Use `true` from `reply` to fall through to the default
 *    dispatch; for anything richer, switch to the subclass style.
 *
 * When both are present, sibling exports win (applied on top of the instance).
 */
export function loadChannel(mod: any, filename: string): Channel {
  if (!mod.default) {
    throw new Error(`[openxyz] channels/${filename} has no default export`);
  }
  if (!(mod.default instanceof Channel)) {
    throw new Error(
      `[openxyz] channels/${filename} default export is not a Channel instance — did you forget \`new\`?`,
    );
  }

  const channel = mod.default as Channel;

  if (mod.filter !== undefined) {
    if (typeof mod.filter !== "function") {
      throw new Error(`[openxyz] channels/${filename} \`filter\` export is not a function`);
    }
    channel.filter = mod.filter as MessageFilter;
  }

  if (mod.reply !== undefined) {
    if (typeof mod.reply !== "function") {
      throw new Error(`[openxyz] channels/${filename} \`reply\` export is not a function`);
    }
    const defaultReply = channel.reply.bind(channel);
    const userReply = mod.reply as ReplyFunc;
    channel.reply = async (thread, message) => {
      const result = await userReply(thread, message);
      if (typeof result === "boolean") {
        return result ? defaultReply(thread, message) : {};
      }
      return result;
    };
  }

  return channel;
}
