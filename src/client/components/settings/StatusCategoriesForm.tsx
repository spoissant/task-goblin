import { useState, useEffect, useRef } from "react";
import {
  useStatusCategoriesQuery,
  useUpdateStatusCategories,
  useStatusSettingsQuery,
  useUpdateDefaultColor,
} from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Badge } from "@/client/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Skeleton } from "@/client/components/ui/skeleton";
import { ArrowUp, ArrowDown, Save, Loader2, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import type { StatusCategory } from "@/client/lib/types";

// Simple tag input component for jiraMappings
interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

function TagInput({ tags, onChange, placeholder = "Add status..." }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const newTag = inputValue.trim();
      if (!tags.some(t => t.toLowerCase() === newTag.toLowerCase())) {
        onChange([...tags, newTag]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div
      className="flex flex-wrap gap-1 p-1 border rounded-md min-h-[2rem] cursor-text bg-background"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, index) => (
        <Badge key={index} variant="secondary" className="h-6 text-xs gap-1 pr-1">
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(index);
            }}
            className="hover:bg-muted-foreground/20 rounded-full p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[80px] h-6 text-xs bg-transparent outline-none"
      />
    </div>
  );
}

const COLOR_OPTIONS = [
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
          <Select value={defaultColor} onValueChange={handleDefaultColorChange}>
            <SelectTrigger className="w-48">
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
                  <Select
                    value={category.color}
                    onValueChange={(v) => handleCategoryChange(index, "color", v)}
                  >
                    <SelectTrigger className="w-full h-8">
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
