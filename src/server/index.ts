import { createRouter } from "./router";
import { routes } from "./routes";
import { withErrorBoundary } from "./middleware";
import { addClient, removeClient, autoBroadcast } from "./lib/sse";
import { startClaudeRuntime } from "./services/claude-runtime";

const port = Number(process.env.PORT) || 3456;
const router = createRouter(routes);

// Run startup tasks
function startup() {
  // Start server. No CORS: the UI reaches it through Vite's same-origin proxy, and the MCP server from Bun.
  Bun.serve({
    port,
    idleTimeout: 120, // 2 minutes for slow API operations
    async fetch(req) {
      const url = new URL(req.url);

      // SSE endpoint — handled before router to avoid response cloning
      if (url.pathname === "/api/v1/events" && req.method === "GET") {
        let client: ReturnType<typeof addClient>;
        const stream = new ReadableStream({
          start(controller) {
            client = addClient(controller);
          },
          cancel() {
            removeClient(client);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Route request with error boundary
      const response = await withErrorBoundary(() => router.route(req));

      // Auto-broadcast SSE for successful mutations
      if (req.method !== "GET" && response.ok) {
        autoBroadcast(url.pathname);
      }

      return response;
    },
  });

  console.log(`Task Goblin API running on :${port}`);

  // Resume interrupted worktree work and start polling background sessions
  startClaudeRuntime();
}

startup();
