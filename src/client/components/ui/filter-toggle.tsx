import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";

interface FilterToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title?: string;
}

/** A labelled checkbox in a page's filter row. */
export function FilterToggle({ id, label, checked, onCheckedChange, title }: FilterToggleProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Label htmlFor={id} className="text-sm cursor-pointer whitespace-nowrap" title={title}>
        {label}
      </Label>
    </div>
  );
}
