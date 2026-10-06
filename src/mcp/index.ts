import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerChoreTools } from "./tools/chores.js";
import { registerReviewTools } from "./tools/reviews.js";
import { registerDevStackTools } from "./tools/dev-stack.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerTaskPrompts } from "./prompts/tasks.js";

const server = new McpServer({
  name: "task-goblin",
  version: "0.0.1",
});

// Register all tools
registerTaskTools(server);
registerChoreTools(server);
registerReviewTools(server);
registerDevStackTools(server);
registerSessionTools(server);

// Register prompts
registerTaskPrompts(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
