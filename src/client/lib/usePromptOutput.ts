import { useEffect, useRef, useState, useMemo } from "react";
import { usePromptQuery } from "./queries/prompts";
import type { PromptStatus } from "./types";

export interface OutputMessage {
  type: string;
  [key: string]: unknown;
}

const TERMINAL_STATUSES: PromptStatus[] = ["done", "failed", "cancelled", "timeout"];

export function usePromptOutput(
  promptId: number | null,
  status?: PromptStatus | null,
) {
  const [sseMessages, setSseMessages] = useState<OutputMessage[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const isTerminal = status ? TERMINAL_STATUSES.includes(status) : false;
  const isActive = !!promptId && !isTerminal;

  // SSE stream for active (running/need_input) prompts
  useEffect(() => {
    if (!isActive || !promptId) {
      setSseMessages([]);
      return;
    }

    const source = new EventSource(`/api/v1/prompts/${promptId}/output`);
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as OutputMessage;
        setSseMessages((prev) => [...prev, message]);
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [promptId, isActive]);

  // Fetch persisted messages for terminal prompts
  const { data: promptDetail } = usePromptQuery(
    promptId ?? 0,
    !!promptId && isTerminal,
  );

  const persistedMessages = useMemo(() => {
    if (!promptDetail?.messages) return [];
    try {
      return JSON.parse(promptDetail.messages) as OutputMessage[];
    } catch {
      return [];
    }
  }, [promptDetail?.messages]);

  return isTerminal ? persistedMessages : sseMessages;
}
