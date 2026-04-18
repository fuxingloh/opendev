import { mcp } from "openxyz/tools/mcp";
import { readEnv } from "openxyz/env";

export default mcp({
  url: "https://app.nocodb.com/mcp/nccjwfx47c69jlyl",
  headers: {
    "xc-mcp-token": readEnv("NOCODB_MCP_TOKEN", {
      description: "NocoDB MCP token — grant access from the NocoDB base MCP settings",
    }),
  },
});
