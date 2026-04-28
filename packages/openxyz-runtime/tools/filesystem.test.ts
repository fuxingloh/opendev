import { describe, expect, test } from "bun:test";
import { InMemoryFs } from "just-bash";
import { FilesystemTools } from "./filesystem.ts";
import type { Drive } from "../drive.ts";

function mkTools(files: Record<string, string> = {}) {
  const fs = new InMemoryFs(files);
  const drive: Drive = { fs: () => fs };
  const tools = new FilesystemTools({ "/workspace": drive }, "read-write").tools();
  return { tools, fs };
}

async function call<T>(t: { execute?: (input: T, opts: object) => Promise<unknown> }, input: T): Promise<unknown> {
  if (!t.execute) throw new Error("tool has no execute");
  return t.execute(input, {} as object);
}

describe("FilesystemTools — read-before-edit gate", () => {
  test("edit fails when file was never read in this turn", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    expect(
      call(tools.edit as never, { path: "/workspace/AGENTS.md", oldString: "hello", newString: "world" }),
    ).rejects.toThrow(/must use the `read` tool/);
  });

  test("edit succeeds after read", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    await call(tools.read as never, { path: "/workspace/AGENTS.md" });
    const result = await call(tools.edit as never, {
      path: "/workspace/AGENTS.md",
      oldString: "hello",
      newString: "world",
    });
    expect(result).toMatch(/replaced 1 occurrence/);
  });

  test("edit after read+edit chain works without re-reading", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello world\n" });
    await call(tools.read as never, { path: "/workspace/AGENTS.md" });
    await call(tools.edit as never, { path: "/workspace/AGENTS.md", oldString: "hello", newString: "hi" });
    const result = await call(tools.edit as never, {
      path: "/workspace/AGENTS.md",
      oldString: "world",
      newString: "earth",
    });
    expect(result).toMatch(/replaced 1 occurrence/);
  });

  test("edit fails when bash modifies the file between read and edit", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    await call(tools.read as never, { path: "/workspace/AGENTS.md" });
    await call(tools.bash as never, {
      command: `echo "tampered" > /workspace/AGENTS.md`,
      workdir: "/workspace",
      description: "tamper",
    });
    expect(
      call(tools.edit as never, { path: "/workspace/AGENTS.md", oldString: "hello", newString: "world" }),
    ).rejects.toThrow(/has changed since you last read it/);
  });
});

describe("FilesystemTools — read-before-write gate", () => {
  test("write to a new file does not require prior read", async () => {
    const { tools } = mkTools({});
    const result = await call(tools.write as never, { path: "/workspace/new.md", content: "fresh\n" });
    expect(result).toMatch(/wrote 6 bytes/);
  });

  test("write over existing file fails without prior read", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    expect(call(tools.write as never, { path: "/workspace/AGENTS.md", content: "new\n" })).rejects.toThrow(
      /already exists.*before overwriting/,
    );
  });

  test("write over existing file succeeds after read", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    await call(tools.read as never, { path: "/workspace/AGENTS.md" });
    const result = await call(tools.write as never, { path: "/workspace/AGENTS.md", content: "new content\n" });
    expect(result).toMatch(/wrote 12 bytes/);
  });

  test("write fails when file changed between read and write", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "hello\n" });
    await call(tools.read as never, { path: "/workspace/AGENTS.md" });
    await call(tools.bash as never, {
      command: `echo "tampered" > /workspace/AGENTS.md`,
      workdir: "/workspace",
      description: "tamper",
    });
    expect(call(tools.write as never, { path: "/workspace/AGENTS.md", content: "new\n" })).rejects.toThrow(
      /has changed since you last read it/,
    );
  });

  test("write updates the read-set so subsequent edits work", async () => {
    const { tools } = mkTools({});
    await call(tools.write as never, { path: "/workspace/new.md", content: "hello world\n" });
    const result = await call(tools.edit as never, {
      path: "/workspace/new.md",
      oldString: "hello",
      newString: "hi",
    });
    expect(result).toMatch(/replaced 1 occurrence/);
  });
});

describe("FilesystemTools — read footer reports shape", () => {
  test("full read footer reports total line count", async () => {
    const { tools } = mkTools({ "/AGENTS.md": "a\nb\nc\n" });
    const result = (await call(tools.read as never, { path: "/workspace/AGENTS.md" })) as string;
    expect(result).toMatch(/\[end of file — 4 lines total\]/);
  });

  test("truncated read footer includes window, total, and continuation offset", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
    const { tools } = mkTools({ "/big.md": lines });
    const result = (await call(tools.read as never, {
      path: "/workspace/big.md",
      offset: 1,
      limit: 3,
    })) as string;
    expect(result).toMatch(/\[showing lines 1-3 of 10 — call read again with offset=4 to continue\]/);
  });
});

describe("FilesystemTools — per-mount permission config", () => {
  function mk(config: ConstructorParameters<typeof FilesystemTools>[1]) {
    const ws: Drive = { fs: () => new InMemoryFs({}) };
    const notes: Drive = { fs: () => new InMemoryFs({ "/note.md": "hi\n" }) };
    const drives = { "/workspace": ws, "/mnt/notes": notes };
    return new FilesystemTools(drives, config).tools();
  }

  test("`*` fallback applies read-only to unlisted mounts while explicit /workspace stays read-write", async () => {
    const tools = mk({ "/workspace": "read-write", "*": "read-only" });
    await call(tools.read as never, { path: "/mnt/notes/note.md" });
    expect(call(tools.write as never, { path: "/mnt/notes/note.md", content: "x" })).rejects.toThrow();
    await call(tools.write as never, { path: "/workspace/new.md", content: "x" });
  });

  test("without `*`, unlisted mounts are dropped entirely", async () => {
    const tools = mk({ "/workspace": "read-write" });
    expect(call(tools.read as never, { path: "/mnt/notes/note.md" })).rejects.toThrow();
  });
});
