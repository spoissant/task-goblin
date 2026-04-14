import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTodoTools } from "./tools/todos.js";
import { registerNoteTools } from "./tools/notes.js";
import { registerChoreTools } from "./tools/chores.js";
import { registerTaskPrompts } from "./prompts/tasks.js";

const server = new McpServer({
  name: "task-goblin",
  version: "0.0.1",
});

// Register all tools
registerTaskTools(server);
registerTodoTools(server);
registerNoteTools(server);
registerChoreTools(server);

// Register prompts
registerTaskPrompts(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
