import { mcp } from "openxyz/tools/mcp";
import { env } from "openxyz/env";

export default mcp({
  url: "https://mcp.linear.app/mcp",
  headers: {
    Authorization: `Bearer ${env.LINEAR_API_KEY.describe("Linear API key — https://linear.app/settings/account/security")}`,
  },
});
