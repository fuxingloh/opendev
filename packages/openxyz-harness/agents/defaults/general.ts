import type { AgentDef } from "../factory";

// language=Markdown
const prompt = ``.trim();

const general: AgentDef = {
  name: "general",
  description: "General-purpose agent for multi-step tasks",
  filesystem: "read-write",
  prompt,
};

export default general;
