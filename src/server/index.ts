import { eq, inArray } from "drizzle-orm";
import { createRouter } from "./router";
import { routes } from "./routes";
import { withCors, handleCors, withErrorBoundary } from "./middleware";
import { migrateTaskStatuses } from "./lib/status-migration";
import { addClient, removeClient, autoBroadcast } from "./lib/sse";
import { addOutputClient, removeOutputClient } from "./services/agent-runtime";
import { db } from "../db";
import { agents, prompts } from "../db/schema";

const port = Number(process.env.PORT) || 3456;
const router = createRouter(routes);

// Run startup tasks
async function startup() {
  // Run migrations
  await migrateTaskStatuses();

  // Startup recovery: reset stale agents and prompts
  await db
    .update(prompts)
    .set({
      status: "failed",
      errorMessage: "Server restarted",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })
    .where(inArray(prompts.status, ["running", "need_input"]));

  await db
    .update(agents)
    .set({ status: "idle", updatedAt: new Date().toISOString() })
    .where(eq(agents.status, "running"));

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

      const url = new URL(req.url);

      // Per-prompt output SSE endpoint
      const outputMatch = url.pathname.match(
        /^\/api\/v1\/prompts\/(\d+)\/output$/
      );
      if (outputMatch && req.method === "GET") {
        const promptId = parseInt(outputMatch[1], 10);
        type OutputClient = { controller: ReadableStreamDefaultController; closed: boolean };
        let outputClient: OutputClient;
        const stream = new ReadableStream({
          start(controller) {
            outputClient = { controller, closed: false };
            addOutputClient(promptId, outputClient);
          },
          cancel() {
            outputClient.closed = true;
            removeOutputClient(promptId, outputClient);
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
