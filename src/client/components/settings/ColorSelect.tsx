import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

export const COLOR_OPTIONS = [
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
];

interface ColorSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
}

export function ColorSelect({ value, onValueChange, triggerClassName }: ColorSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COLOR_OPTIONS.map((color) => (
          <SelectItem key={color.value} value={color.value}>
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded ${color.value}`} />
              {color.label}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
