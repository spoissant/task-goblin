import { createRouter } from "./router";
import { routes } from "./routes";
import { withCors, handleCors, withErrorBoundary } from "./middleware";
import { migrateTaskStatuses } from "./lib/status-migration";

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

      // Route request with error boundary
      const response = await withErrorBoundary(() => router.route(req));

      // Add CORS headers to response
      return withCors(response);
    },
  });

  console.log(`Task Goblin API running on :${port}`);
}

startup();
