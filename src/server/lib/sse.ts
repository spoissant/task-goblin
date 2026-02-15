type SSEClient = {
  controller: ReadableStreamDefaultController;
  closed: boolean;
};

const clients = new Set<SSEClient>();

export function addClient(controller: ReadableStreamDefaultController): SSEClient {
  const client: SSEClient = { controller, closed: false };
  // Flush a comment immediately so proxies (e.g. Vite) fully establish the connection
  try {
    controller.enqueue(new TextEncoder().encode(": ok\n\n"));
  } catch {
    // ignore — client may have disconnected already
  }
  clients.add(client);
  return client;
}

export function removeClient(client: SSEClient) {
  client.closed = true;
  clients.delete(client);
}

export function broadcast(entity: string, payload?: Record<string, unknown>) {
  const data = JSON.stringify({ entity, ...payload });
  const message = `data: ${data}\n\n`;
  const encoded = new TextEncoder().encode(message);

  for (const client of clients) {
    if (client.closed) continue;
    try {
      client.controller.enqueue(encoded);
    } catch {
      removeClient(client);
    }
  }
}

export function autoBroadcast(pathname: string) {
  let entity: string | null = null;
  if (pathname.includes("/logs")) entity = "log";
  else if (pathname.includes("/todos")) entity = "todo";
  else if (pathname.includes("/notes")) entity = "note";
  else if (pathname.includes("/blocked-by")) entity = "blocker";
  else if (pathname.includes("/settings")) entity = "setting";
  else if (pathname.includes("/agents")) entity = "agent";
  else if (pathname.includes("/prompts")) entity = "prompt";
  else if (
    pathname.includes("/tasks") ||
    pathname.includes("/sync") ||
    pathname.includes("/deploy") ||
    pathname.includes("/sync-branch") ||
    pathname.includes("/backfill")
  ) entity = "task";
  if (entity) broadcast(entity);
}

// Heartbeat every 30s to keep connections alive
setInterval(() => {
  const comment = new TextEncoder().encode(": heartbeat\n\n");
  for (const client of clients) {
    if (client.closed) continue;
    try {
      client.controller.enqueue(comment);
    } catch {
      removeClient(client);
    }
  }
}, 30_000);
