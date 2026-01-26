import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { BADGE_COLORS, type BadgeColorName } from "@/client/components/tasks/RepoBadge";

interface BadgeColorSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
}

export function BadgeColorSelect({ value, onValueChange, triggerClassName }: BadgeColorSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.keys(BADGE_COLORS).map((color) => (
          <SelectItem key={color} value={color}>
            <span className="flex items-center gap-2">
              <span
                className={`inline-block w-3 h-3 rounded-full ${BADGE_COLORS[color as BadgeColorName].split(" ")[0]}`}
              />
              {color}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
