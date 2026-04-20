import { mcp } from "openxyz/tools/mcp";
import { readEnv } from "openxyz/env";

export default mcp({
  url: "https://mcp.agentmail.to/mcp",
  headers: {
    Authorization: `Bearer ${readEnv("AGENT_MAIL_API_KEY", {
      description: "AgentMail API key — https://console.agentmail.to",
    })}`,
  },
});
