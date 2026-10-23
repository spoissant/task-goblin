import { useState, useEffect } from "react";
import {
  useUpdateStatusCategories,
  useStatusSettingsQuery,
  useUpdateDefaultColor,
} from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Skeleton } from "@/client/components/ui/skeleton";
import { ArrowUp, ArrowDown, Save, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { TagInput } from "./TagInput";
import { ColorSelect, STATUS_COLOR_OPTIONS } from "./ColorSelect";
import type { StatusCategory } from "@/shared/types";

// A category being edited, without id since we're bulk replacing. Its order is
// its position in the list, numbered on save.
type CategoryDraft = Omit<StatusCategory, "id" | "displayOrder">;

export function StatusCategoriesForm() {
  const { data: settingsData, isLoading, error } = useStatusSettingsQuery();
  const updateCategories = useUpdateStatusCategories();
  const updateDefaultColor = useUpdateDefaultColor();

  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [defaultColor, setDefaultColor] = useState("bg-slate-500");
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from query data
  useEffect(() => {
    if (settingsData?.categories) {
      setCategories(settingsData.categories.map(({ name, color, done, jiraMappings }) => ({
        name,
        color,
        done,
        jiraMappings,
      })));
      setHasChanges(false);
    }
  }, [settingsData?.categories]);

  useEffect(() => {
    if (settingsData?.defaultColor) {
      setDefaultColor(settingsData.defaultColor);
    }
  }, [settingsData?.defaultColor]);

  const handleCategoryChange = (index: number, patch: Partial<CategoryDraft>) => {
    setCategories((prev) => prev.map((category, i) => (i === index ? { ...category, ...patch } : category)));
    setHasChanges(true);
  };

  const handleDeleteCategory = (index: number) => {
    if (categories.length <= 1) {
      toast.error("Cannot delete the last category");
      return;
    }
    setCategories((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleDefaultColorChange = (value: string) => {
    setDefaultColor(value);
    setHasChanges(true);
  };

  // Swap a category with its neighbour; the buttons are disabled at the ends.
  const move = (index: number, delta: number) => {
    setCategories((prev) => {
      const next = [...prev];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updateCategories.mutateAsync(categories.map((category, displayOrder) => ({ ...category, displayOrder })));

      // Also update default color if it changed
      if (settingsData?.defaultColor !== defaultColor) {
        await updateDefaultColor.mutateAsync(defaultColor);
      }

      toast.success("Status categories saved");
      setHasChanges(false);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleAddCategory = () => {
    setCategories((prev) => [...prev, { name: "New Category", color: "bg-slate-500", done: false, jiraMappings: [] }]);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive">Failed to load status categories</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">Default Color</label>
          <p className="text-xs text-muted-foreground mb-2">
            Applied to unmapped statuses
          </p>
          <ColorSelect
            value={defaultColor}
            onValueChange={handleDefaultColorChange}
            options={STATUS_COLOR_OPTIONS}
            triggerClassName="w-48"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAddCategory}>
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || updateCategories.isPending}>
            {updateCategories.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Order</TableHead>
              <TableHead className="w-[120px]">Name</TableHead>
              <TableHead className="w-[150px]">Color</TableHead>
              <TableHead className="min-w-[200px]">Jira Mapping</TableHead>
              <TableHead className="w-[70px] text-center">Done</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category, index) => (
              <CategoryRow
                key={index}
                category={category}
                isFirst={index === 0}
                isLast={index === categories.length - 1}
                onChange={(patch) => handleCategoryChange(index, patch)}
                onMove={(delta) => move(index, delta)}
                onDelete={() => handleDeleteCategory(index)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          <strong>Jira Mapping:</strong> Jira statuses that map to this category's color. Press Enter to add.
        </p>
        <p>
          <strong>Done:</strong> Tasks with these statuses appear only in the Completed page
        </p>
        <p>
          <strong>Order:</strong> Determines sort order for tasks (top = sorted first)
        </p>
      </div>
    </div>
  );
}

interface CategoryRowProps {
  category: CategoryDraft;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<CategoryDraft>) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}

function CategoryRow({ category, isFirst, isLast, onChange, onMove, onDelete }: CategoryRowProps) {
  const isOnly = isFirst && isLast;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(-1)} disabled={isFirst}>
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(1)} disabled={isLast}>
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Input
          value={category.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-8 font-medium"
        />
      </TableCell>
      <TableCell>
        <ColorSelect
          value={category.color}
          onValueChange={(color) => onChange({ color })}
          options={STATUS_COLOR_OPTIONS}
          triggerClassName="w-full h-8"
        />
      </TableCell>
      <TableCell>
        <TagInput
          tags={category.jiraMappings}
          onChange={(jiraMappings) => onChange({ jiraMappings })}
          placeholder="Add Jira status..."
        />
      </TableCell>
      <TableCell className="text-center">
        <Checkbox checked={category.done} onCheckedChange={(checked) => onChange({ done: !!checked })} />
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={isOnly}
          title={isOnly ? "Cannot delete the last category" : "Delete category"}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
