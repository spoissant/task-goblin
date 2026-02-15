import { useEffect, useRef } from "react";
import type { OutputMessage } from "@/client/lib/usePromptOutput";

interface AgentTerminalProps {
  messages: OutputMessage[];
}

function formatToolArgs(block: any): string {
  const input = block.input;
  if (!input) return "...";
  // Show the most relevant arg per tool
  if (input.pattern) return input.pattern;
  if (input.file_path) return input.file_path.split("/").slice(-2).join("/");
  if (input.command) return input.command.length > 60 ? input.command.slice(0, 60) + "…" : input.command;
  if (input.description) return input.description;
  if (input.query) return input.query;
  if (input.prompt) return input.prompt.length > 60 ? input.prompt.slice(0, 60) + "…" : input.prompt;
  return "...";
}

function formatMessage(msg: OutputMessage): string | null {
  // SDK wraps assistant/user messages under msg.message
  if (msg.type === "assistant" && msg.message) {
    const content = (msg.message as any).content;
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (block.type === "text") return block.text;
          if (block.type === "tool_use") return `> ${block.name}(${formatToolArgs(block)})`;
          return null;
        })
        .filter(Boolean)
        .join("\n");
    }
    if (typeof content === "string") return content;
  }
  if (msg.type === "result" && "result" in msg) {
    return `\n--- Result ---\n${msg.result}`;
  }
  if (msg.type === "system" && (msg as any).subtype === "need_input") {
    return `\n⚠ Tool approval needed: ${(msg as any).toolName}`;
  }
  if (msg.type === "system" && (msg as any).subtype === "input_response") {
    return (msg as any).approved
      ? "✓ Approved"
      : `✗ Denied: ${(msg as any).message || "User denied permission"}`;
  }
  return null;
}

export function AgentTerminal({ messages }: AgentTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const lines = messages.map(formatMessage).filter(Boolean);

  return (
    <div
      ref={scrollRef}
      className="bg-zinc-950 text-zinc-300 font-mono text-xs p-3 rounded-md overflow-y-auto flex-1 min-h-0"
    >
      {lines.length === 0 ? (
        <span className="text-zinc-600">Waiting for output...</span>
      ) : (
        lines.map((line, i) => (
          <pre key={i} className="whitespace-pre-wrap break-words mb-1">
            {line}
          </pre>
        ))
      )}
    </div>
  );
}
