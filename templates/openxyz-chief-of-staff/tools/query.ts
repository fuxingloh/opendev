// TODO(?): maybe implement `openxyz/schema` or `openxyz/zod`
import { tool } from "openxyz/tools";

export default tool({
  description: "Query the project database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    // Your database logic here
    return `Executed query: ${args.query}`;
  },
});
