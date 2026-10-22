import { createRouter, type Routes } from "../server/router";
import { withErrorBoundary } from "../server/middleware";

/** Call `routes` the way the server does (router and error boundary), without listening on a port. */
export function routeClient(routes: Routes) {
  const router = createRouter(routes);
  return (method: string, path: string, body?: unknown): Promise<Response> => {
    const req = new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return withErrorBoundary(() => router.route(req));
  };
}
