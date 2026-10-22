import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { BADGE_COLORS } from "@/client/components/tasks/RepoBadge";

interface ColorOption {
  value: string;
  label: string;
  /** Background class of the swatch next to the label. */
  swatch: string;
}

/** Status category colors: the value is the badge's background class. */
export const STATUS_COLOR_OPTIONS: ColorOption[] = [
  { value: "bg-slate-500", label: "Slate" },
  { value: "bg-gray-500", label: "Gray" },
  { value: "bg-red-500", label: "Red" },
  { value: "bg-orange-500", label: "Orange" },
  { value: "bg-amber-500", label: "Amber" },
  { value: "bg-yellow-500", label: "Yellow" },
  { value: "bg-yellow-600", label: "Yellow (Dark)" },
  { value: "bg-lime-500", label: "Lime" },
  { value: "bg-green-500", label: "Green" },
  { value: "bg-green-700", label: "Green (Dark)" },
  { value: "bg-emerald-500", label: "Emerald" },
  { value: "bg-teal-500", label: "Teal" },
  { value: "bg-cyan-500", label: "Cyan" },
  { value: "bg-sky-500", label: "Sky" },
  { value: "bg-blue-500", label: "Blue" },
  { value: "bg-blue-600", label: "Blue (Dark)" },
  { value: "bg-indigo-500", label: "Indigo" },
  { value: "bg-violet-500", label: "Violet" },
  { value: "bg-purple-500", label: "Purple" },
  { value: "bg-fuchsia-500", label: "Fuchsia" },
  { value: "bg-pink-500", label: "Pink" },
  { value: "bg-rose-500", label: "Rose" },
].map((color) => ({ ...color, swatch: color.value }));

/** Repository badge colors: the value is the color's name. */
export const BADGE_COLOR_OPTIONS: ColorOption[] = Object.entries(BADGE_COLORS).map(([name, classes]) => ({
  value: name,
  label: name,
  swatch: classes.split(" ")[0],
}));

interface ColorSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ColorOption[];
  triggerClassName?: string;
}

export function ColorSelect({ value, onValueChange, options, triggerClassName }: ColorSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((color) => (
          <SelectItem key={color.value} value={color.value}>
            <span className="flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-full ${color.swatch}`} />
              {color.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
