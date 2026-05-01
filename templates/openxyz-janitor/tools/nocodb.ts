import { mcp } from "openxyz/tools/mcp";
import { env } from "openxyz/env";

export default mcp({
  url: "https://app.nocodb.com/mcp/nccjwfx47c69jlyl",
  headers: {
    "xc-mcp-token": env.NOCODB_MCP_TOKEN.describe("NocoDB MCP token — grant access from the NocoDB base MCP settings"),
  },
});
