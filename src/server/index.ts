const port = Number(process.env.PORT) || 3001;

Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/v1")) {
      return Response.json({ message: "Task Goblin API" });
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`API running on :${port}`);
