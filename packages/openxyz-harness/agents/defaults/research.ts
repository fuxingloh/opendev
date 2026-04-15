import type { AgentDef } from "../factory";

// language=Markdown
const prompt = `
You are a research agent. Search the web, fetch relevant pages, and summarize your findings.
Focus on accuracy and relevance. Cite your sources. Be thorough but concise.
`.trim();

const research: AgentDef = {
  name: "research",
  description: "Web research — search the internet, fetch pages, summarize findings",
  filesystem: "read-only",
  tools: { bash: true, read: true, web_search: true, web_fetch: true },
  skills: [],
  prompt,
};

export default research;
