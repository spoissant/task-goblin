import { useState, useEffect, useRef } from "react";
import {
  useTaskFiltersQuery,
  useUpdateTaskFilters,
} from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
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
import type { TaskFilter } from "@/client/lib/types";

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

// Local state type (without id since we're bulk replacing)
type FilterDraft = Omit<TaskFilter, "id">;

export function TaskFiltersForm() {
  const { data, isLoading, error } = useTaskFiltersQuery();
  const updateFilters = useUpdateTaskFilters();

  const [filters, setFilters] = useState<FilterDraft[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from query data
  useEffect(() => {
    if (data?.items) {
      // Remove id from each filter for local state
      setFilters(data.items.map(({ name, position, jiraMappings }) => ({
        name,
        position,
        jiraMappings,
      })));
      setHasChanges(false);
    }
  }, [data?.items]);

  const handleFilterChange = (
    index: number,
    field: keyof FilterDraft,
    value: FilterDraft[keyof FilterDraft]
  ) => {
    setFilters((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setHasChanges(true);
  };

  const handleDeleteFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setFilters((prev) => {
      const next = [...prev];
      // Swap position values
      const temp = next[index].position;
      next[index].position = next[index - 1].position;
      next[index - 1].position = temp;
      // Swap positions
      [next[index], next[index - 1]] = [next[index - 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleMoveDown = (index: number) => {
    if (index === filters.length - 1) return;
    setFilters((prev) => {
      const next = [...prev];
      // Swap position values
      const temp = next[index].position;
      next[index].position = next[index + 1].position;
      next[index + 1].position = temp;
      // Swap positions
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Normalize positions to be sequential
    const normalizedFilters = filters.map((filter, index) => ({
      ...filter,
      position: index,
    }));

    try {
      await updateFilters.mutateAsync(normalizedFilters);
      toast.success("Task filters saved");
      setHasChanges(false);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleJiraMappingChange = (index: number, mapping: string[]) => {
    handleFilterChange(index, "jiraMappings", mapping);
  };

  const handleAddFilter = () => {
    const maxPosition = Math.max(...filters.map(f => f.position), -1);
    const newFilter: FilterDraft = {
      name: "New Filter",
      position: maxPosition + 1,
      jiraMappings: [],
    };
    setFilters(prev => [...prev, newFilter]);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive">Failed to load task filters</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Filters appear as tabs on the Tasks page. "All" tab is always first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAddFilter}>
            <Plus className="h-4 w-4 mr-2" />
            Add Filter
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || updateFilters.isPending}>
            {updateFilters.isPending ? (
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
              <TableHead className="w-[150px]">Tab Name</TableHead>
              <TableHead className="min-w-[300px]">Included Statuses</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No filters configured. Only the "All" tab will be shown.
                </TableCell>
              </TableRow>
            ) : (
              filters.map((filter, index) => (
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
                        disabled={index === filters.length - 1}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={filter.name}
                      onChange={(e) => handleFilterChange(index, "name", e.target.value)}
                      className="h-8 font-medium"
                    />
                  </TableCell>
                  <TableCell>
                    <TagInput
                      tags={filter.jiraMappings}
                      onChange={(mapping) => handleJiraMappingChange(index, mapping)}
                      placeholder="Add Jira status..."
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteFilter(index)}
                      title="Delete filter"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          <strong>Included Statuses:</strong> Tasks with these Jira statuses will appear in this filter tab. Press Enter to add.
        </p>
        <p>
          <strong>Unknown statuses:</strong> Tasks with statuses not mapped to any filter will only appear in the "All" tab.
        </p>
      </div>
    </div>
  );
}
