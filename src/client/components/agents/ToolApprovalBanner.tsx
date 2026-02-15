import { Button } from "@/client/components/ui/button";
import { useRespondToPrompt } from "@/client/lib/queries/prompts";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Prompt } from "@/client/lib/types";
import { QuestionApproval } from "./QuestionApproval";

interface ToolApprovalBannerProps {
  prompt: Prompt;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onRespond?: () => void;
}

export function ToolApprovalBanner({ prompt, expanded, onToggleExpand, onRespond }: ToolApprovalBannerProps) {
  const respond = useRespondToPrompt();

  let toolName = "";
  let input: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(prompt.inputRequest || "{}");
    toolName = parsed.toolName || "Unknown tool";
    input = parsed.input || {};
  } catch {
    toolName = "Unknown tool";
  }

  const isQuestion = toolName === "AskUserQuestion" && Array.isArray(input.questions);

  return (
    <div className={`bg-amber-950/50 border border-amber-700/50 rounded-md p-3 space-y-2 flex flex-col ${expanded ? "flex-1 overflow-y-auto min-h-0" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-amber-300">
          {isQuestion ? "Agent question" : <>Tool approval: <span className="font-mono">{toolName}</span></>}
        </div>
        {onToggleExpand && (
          <Button size="icon" variant="ghost" className="h-6 w-6 text-amber-300 hover:text-amber-200" onClick={onToggleExpand}>
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
      {isQuestion ? (
        <QuestionApproval
          questions={input.questions as any}
          promptId={prompt.id}
          onRespond={onRespond}
        />
      ) : (
        <>
          {Object.entries(input).length > 0 && (
            <div className={`space-y-1.5 ${expanded ? "overflow-y-auto" : "max-h-24 overflow-y-auto"}`}>
              {Object.entries(input).map(([key, value]) => (
                <div key={key}>
                  <div className="text-[10px] font-medium text-amber-400/60 uppercase tracking-wide">{key}</div>
                  <pre className="text-xs text-amber-200/70 font-mono whitespace-pre-wrap break-words">
                    {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              className="bg-green-700 hover:bg-green-600"
              onClick={() => { respond.mutate({ id: prompt.id, approved: true }); onRespond?.(); }}
              disabled={respond.isPending}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => { respond.mutate({ id: prompt.id, approved: false }); onRespond?.(); }}
              disabled={respond.isPending}
            >
              Deny
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
