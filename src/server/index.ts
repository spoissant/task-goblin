import { createRouter } from "./router";
import { routes } from "./routes";
import { withCors, handleCors, withErrorBoundary } from "./middleware";
import { migrateTaskStatuses } from "./lib/status-migration";
import { addClient, removeClient, autoBroadcast } from "./lib/sse";

const port = Number(process.env.PORT) || 3456;
const router = createRouter(routes);

// Run startup tasks
async function startup() {
  // Run migrations
  await migrateTaskStatuses();

  // Start server
  Bun.serve({
    port,
    idleTimeout: 120, // 2 minutes for slow API operations
    async fetch(req) {
      // Handle CORS preflight
      const corsResponse = handleCors(req);
      if (corsResponse) {
        return corsResponse;
      }

      // SSE endpoint — handled before router to avoid response cloning
      const url = new URL(req.url);
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
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Route request with error boundary
      const response = await withErrorBoundary(() => router.route(req));

      // Auto-broadcast SSE for successful mutations
      if (req.method !== "GET" && response.ok) {
        autoBroadcast(url.pathname);
      }

      // Add CORS headers to response
      return withCors(response);
    },
  });

  console.log(`Task Goblin API running on :${port}`);
}

startup();
