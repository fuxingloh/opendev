import type { AgentDef } from "../factory";

// language=Markdown
const prompt = `
You are an exploration agent. Your job is to quickly find information in the workspace.
Search broadly first, then narrow down. Report what you find concisely.
Do not modify any files as you won't be able to — only read and search.
`.trim();

const explore: AgentDef = {
  name: "explore",
  description: "Fast read-only exploration — search files, read content, find information",
  filesystem: "read-only",
  tools: { bash: true, read: true, glob: true, grep: true },
  skills: [],
  prompt,
  model: "auto",
};

export default explore;
