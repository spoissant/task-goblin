import { useState, type ComponentProps } from "react";
import { Input } from "@/client/components/ui/input";

type SaveOnBlurInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  /** Gets the trimmed text when the field loses focus with a change (Enter blurs it). */
  onSave: (value: string) => void;
};

/** What to save as the field loses focus: the trimmed draft, or null when it's unedited or unchanged. */
export function draftToSave(draft: string | null, value: string): string | null {
  if (draft === null) return null;
  const trimmed = draft.trim();
  return trimmed === value ? null : trimmed;
}

/** A text field that keeps the edit as a local draft and saves it on blur or Enter. */
export function SaveOnBlurInput({ value, onSave, ...props }: SaveOnBlurInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      {...props}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draftToSave(draft, value);
        if (next !== null) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
