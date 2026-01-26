import { useState, useEffect } from "react";
import {
  useStatusCategoriesQuery,
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
import { ColorSelect } from "./ColorSelect";
import type { StatusCategory } from "@/client/lib/types";

// Local state type (without id since we're bulk replacing)
type CategoryDraft = Omit<StatusCategory, "id">;

export function StatusCategoriesForm() {
  const { data: categoriesData, isLoading: categoriesLoading, error: categoriesError } = useStatusCategoriesQuery();
  const { data: settingsData, isLoading: settingsLoading } = useStatusSettingsQuery();
  const updateCategories = useUpdateStatusCategories();
  const updateDefaultColor = useUpdateDefaultColor();

  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [defaultColor, setDefaultColor] = useState("bg-slate-500");
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from query data
  useEffect(() => {
    if (categoriesData?.items) {
      // Remove id from each category for local state
      setCategories(categoriesData.items.map(({ name, color, done, displayOrder, jiraMappings }) => ({
        name,
        color,
        done,
        displayOrder,
        jiraMappings,
      })));
      setHasChanges(false);
    }
  }, [categoriesData?.items]);

  useEffect(() => {
    if (settingsData?.defaultColor) {
      setDefaultColor(settingsData.defaultColor);
    }
  }, [settingsData?.defaultColor]);

  const handleCategoryChange = (
    index: number,
    field: keyof CategoryDraft,
    value: CategoryDraft[keyof CategoryDraft]
  ) => {
    setCategories((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
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

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setCategories((prev) => {
      const next = [...prev];
      // Swap displayOrder values
      const temp = next[index].displayOrder;
      next[index].displayOrder = next[index - 1].displayOrder;
      next[index - 1].displayOrder = temp;
      // Swap positions
      [next[index], next[index - 1]] = [next[index - 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleMoveDown = (index: number) => {
    if (index === categories.length - 1) return;
    setCategories((prev) => {
      const next = [...prev];
      // Swap displayOrder values
      const temp = next[index].displayOrder;
      next[index].displayOrder = next[index + 1].displayOrder;
      next[index + 1].displayOrder = temp;
      // Swap positions
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Normalize displayOrder to be sequential
    const normalizedCategories = categories.map((cat, index) => ({
      ...cat,
      displayOrder: index,
    }));

    try {
      await updateCategories.mutateAsync(normalizedCategories);

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

  const handleJiraMappingChange = (index: number, mapping: string[]) => {
    handleCategoryChange(index, "jiraMappings", mapping);
  };

  const handleAddCategory = () => {
    const maxOrder = Math.max(...categories.map(c => c.displayOrder), -1);
    const newCategory: CategoryDraft = {
      name: "New Category",
      color: "bg-slate-500",
      done: false,
      displayOrder: maxOrder + 1,
      jiraMappings: [],
    };
    setCategories(prev => [...prev, newCategory]);
    setHasChanges(true);
  };

  if (categoriesLoading || settingsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (categoriesError) {
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
              <TableRow key={index}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === categories.length - 1}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    value={category.name}
                    onChange={(e) => handleCategoryChange(index, "name", e.target.value)}
                    className="h-8 font-medium"
                  />
                </TableCell>
                <TableCell>
                  <ColorSelect
                    value={category.color}
                    onValueChange={(v) => handleCategoryChange(index, "color", v)}
                    triggerClassName="w-full h-8"
                  />
                </TableCell>
                <TableCell>
                  <TagInput
                    tags={category.jiraMappings}
                    onChange={(mapping) => handleJiraMappingChange(index, mapping)}
                    placeholder="Add Jira status..."
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={category.done}
                    onCheckedChange={(checked) =>
                      handleCategoryChange(index, "done", !!checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteCategory(index)}
                    disabled={categories.length <= 1}
                    title={categories.length <= 1 ? "Cannot delete the last category" : "Delete category"}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
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
