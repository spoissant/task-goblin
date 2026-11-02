// Prefix every console line with a local-time timestamp (YYYY-MM-DD HH:mm:ss). Imported first by the server entry.
const stamp = () => new Date().toLocaleString("sv-SE");

for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(stamp(), ...args);
}
