import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTodoTools } from "./tools/todos.js";
import { registerRefreshTools } from "./tools/refresh.js";

const server = new McpServer({
  name: "task-goblin",
  version: "0.0.1",
});

// Register all tools
registerTaskTools(server);
registerTodoTools(server);
registerRefreshTools(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
