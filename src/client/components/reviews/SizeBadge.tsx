import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import type { PrSize } from "@/shared/types";

const SIZES: Record<PrSize, { label: string; estimate: string; icon: typeof SignalLow; color: string }> = {
  small: { label: "Small", estimate: "< 10 min", icon: SignalLow, color: "text-emerald-600" },
  medium: { label: "Medium", estimate: "< 30 min", icon: SignalMedium, color: "text-amber-600" },
  large: { label: "Large", estimate: "30+ min", icon: SignalHigh, color: "text-red-600" },
};

/** A PR's review effort, in the flat list's Size column. */
export function SizeBadge({ size }: { size: PrSize }) {
  const { label, icon: Icon, color } = SIZES[size];
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Icon className={`h-4 w-4 ${color}`} />
      <span>{label}</span>
    </span>
  );
}

/** The heading over a size group: its review time and how many PRs it holds. */
export function SizeHeading({ size, count }: { size: PrSize; count: number }) {
  const { label, estimate, icon: Icon, color } = SIZES[size];
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={`h-4 w-4 ${color}`} />
      <h2 className="text-base font-semibold">{label}</h2>
      <span className="text-xs text-muted-foreground">{estimate}</span>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );
}
