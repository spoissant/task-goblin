import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { Textarea } from "@/client/components/ui/textarea";
import { useRespondToPrompt } from "@/client/lib/queries/prompts";

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface QuestionApprovalProps {
  questions: Question[];
  promptId: number;
  onRespond?: () => void;
}

export function QuestionApproval({ questions, promptId, onRespond }: QuestionApprovalProps) {
  const respond = useRespondToPrompt();
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});

  function toggleOption(qIdx: number, label: string, multiSelect: boolean) {
    setSelections((prev) => {
      const current = prev[qIdx] || [];
      if (multiSelect) {
        return { ...prev, [qIdx]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label] };
      }
      return { ...prev, [qIdx]: current.includes(label) ? [] : [label] };
    });
  }

  function formatAnswers(): string {
    return questions
      .map((q, i) => {
        const selected = selections[i] || [];
        const other = otherTexts[i]?.trim();
        const parts = [...selected];
        if (other) parts.push(`Other - ${other}`);
        return `${q.header}: ${parts.join(", ") || "(no selection)"}`;
      })
      .join("\n");
  }

  function handleSubmit() {
    respond.mutate({ id: promptId, approved: false, message: formatAnswers() });
    onRespond?.();
  }

  const hasAnswer = questions.some(
    (_, i) => (selections[i]?.length ?? 0) > 0 || otherTexts[i]?.trim(),
  );

  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={i} className="space-y-1.5">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            {q.header}
          </Badge>
          <div className="text-sm text-amber-200">{q.question}</div>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const active = selections[i]?.includes(opt.label);
              return (
                <Button
                  key={opt.label}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className={active ? "bg-amber-700 hover:bg-amber-600 text-white" : "border-amber-700/50 text-amber-300 hover:bg-amber-800/50"}
                  title={opt.description}
                  onClick={() => toggleOption(i, opt.label, q.multiSelect)}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
          <Textarea
            placeholder="Other..."
            className="min-h-8 h-8 text-xs bg-transparent border-amber-700/50 text-amber-200 placeholder:text-amber-500/50 focus-visible:border-amber-500"
            value={otherTexts[i] || ""}
            onChange={(e) => setOtherTexts((prev) => ({ ...prev, [i]: e.target.value }))}
          />
        </div>
      ))}
      <Button
        size="sm"
        className="bg-amber-700 hover:bg-amber-600"
        onClick={handleSubmit}
        disabled={respond.isPending || !hasAnswer}
      >
        Submit
      </Button>
    </div>
  );
}
