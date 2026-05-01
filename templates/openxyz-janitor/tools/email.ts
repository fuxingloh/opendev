import { mcp } from "openxyz/tools/mcp";
import { env } from "openxyz/env";

export default mcp({
  url: "https://mcp.agentmail.to/mcp",
  headers: {
    "X-API-Key": env.AGENT_MAIL_API_KEY.describe("AgentMail API key — https://console.agentmail.to"),
  },
});
