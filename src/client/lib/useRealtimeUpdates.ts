import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const ENTITY_TO_QUERY_KEYS: Record<string, string[][]> = {
  task: [["tasks"]],
  todo: [["todos"], ["tasks"]],
  note: [["notes"], ["tasks"]],
  log: [["logs"], ["tasks"]],
  setting: [["settings"], ["statusCategories"]],
};

export function useRealtimeUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/v1/events");

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { entity } = data;

        const keys = ENTITY_TO_QUERY_KEYS[entity];
        if (keys) {
          for (const queryKey of keys) {
            queryClient.invalidateQueries({ queryKey });
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    return () => source.close();
  }, [queryClient]);
}
