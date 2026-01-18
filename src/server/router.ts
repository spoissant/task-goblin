type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteHandler = (
  req: Request,
  params: Record<string, string>
) => Promise<Response> | Response;

export type RouteDefinition = {
  [method in HttpMethod]?: RouteHandler;
};

export type Routes = {
  [pattern: string]: RouteDefinition;
};

type CompiledRoute = {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handlers: RouteDefinition;
};

function patternToRegex(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

export function createRouter(routes: Routes) {
  const compiled: CompiledRoute[] = Object.entries(routes).map(
    ([pattern, handlers]) => {
      const { regex, paramNames } = patternToRegex(pattern);
      return { pattern, regex, paramNames, handlers };
    }
  );

  // Sort routes: static routes first, then by specificity (fewer params = more specific)
  compiled.sort((a, b) => {
    const aParams = a.paramNames.length;
    const bParams = b.paramNames.length;
    if (aParams === 0 && bParams > 0) return -1;
    if (bParams === 0 && aParams > 0) return 1;
    return a.pattern.length - b.pattern.length;
  });

  return {
    match(
      pathname: string,
      method: string
    ): { handler: RouteHandler; params: Record<string, string> } | null {
      for (const route of compiled) {
        const match = route.regex.exec(pathname);
        if (match) {
          const handler = route.handlers[method as HttpMethod];
          if (handler) {
            const params: Record<string, string> = {};
            route.paramNames.forEach((name, i) => {
              params[name] = match[i + 1];
            });
            return { handler, params };
          }
        }
      }
      return null;
    },

    async route(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      const result = this.match(pathname, method);
      if (!result) {
        // Check if path exists but method not allowed
        for (const route of compiled) {
          if (route.regex.test(pathname)) {
            return new Response(null, {
              status: 405,
              headers: {
                Allow: Object.keys(route.handlers).join(", "),
              },
            });
          }
        }
        return Response.json(
          { error: { code: "NOT_FOUND", message: "Route not found" } },
          { status: 404 }
        );
      }

      return result.handler(req, result.params);
    },
  };
}
