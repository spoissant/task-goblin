import { useEffect, useState } from "react";

/** Milliseconds until `at`, ticking every second; null without a time. */
export function useCountdown(at: string | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  return at ? Math.max(0, Date.parse(at) - now) : null;
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
