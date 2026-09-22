import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/client/lib/utils";

interface CopyChipProps {
  /** Text written to the clipboard. */
  value: string;
  /** Toast shown after copying; defaults to "Copied: <value>". */
  message?: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}

/** Inline monospace button that copies `value` to the clipboard on click. */
export function CopyChip({ value, message, className, title, children }: CopyChipProps) {
  return (
    <button
      type="button"
      title={title ?? "Copy to clipboard"}
      className={cn("font-mono text-xs hover:text-blue-600 cursor-pointer text-left", className)}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        toast.success(message ?? `Copied: ${value}`);
      }}
    >
      {children ?? value}
    </button>
  );
}
