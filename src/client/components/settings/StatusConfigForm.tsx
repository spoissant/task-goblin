import { useState, useEffect, useRef } from "react";
import {
  useStatusConfigQuery,
  useUpdateStatusConfig,
  useFetchJiraStatuses,
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
import { ArrowUp, ArrowDown, RefreshCw, Save, Loader2, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import type { StatusConfig } from "@/client/lib/types";

const USE_DEFAULT_VALUE = "__default__";

// Simple tag input component for jiraMapping
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
  { value: USE_DEFAULT_VALUE, label: "Use Default" },
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

export function StatusConfigForm() {
  const { data, isLoading, error } = useStatusConfigQuery();
  const updateConfig = useUpdateStatusConfig();
  const fetchStatuses = useFetchJiraStatuses();

  const [statuses, setStatuses] = useState<StatusConfig[]>([]);
  const [defaultColor, setDefaultColor] = useState("bg-slate-500");
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from query data
  useEffect(() => {
    if (data) {
      setStatuses(data.statuses);
      setDefaultColor(data.defaultColor);
      setHasChanges(false);
    }
  }, [data]);

  const handleStatusChange = (
    index: number,
    field: keyof StatusConfig,
    value: StatusConfig[keyof StatusConfig]
  ) => {
    setStatuses((prev) => {
      const next = [...prev];
      // Special handling for isDefault - only one can be true
      if (field === "isDefault" && value === true) {
        // Clear isDefault from all other statuses
        for (let i = 0; i < next.length; i++) {
          if (i !== index) {
            next[i] = { ...next[i], isDefault: false };
          }
        }
      }
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setHasChanges(true);
  };

  const handleDeleteStatus = (index: number) => {
    const status = statuses[index];
    if (status.isDefault) {
      toast.error("Cannot delete the default status");
      return;
    }
    setStatuses((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleDefaultColorChange = (value: string) => {
    setDefaultColor(value);
    setHasChanges(true);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setStatuses((prev) => {
      const next = [...prev];
      // Swap order values
      const temp = next[index].order;
      next[index].order = next[index - 1].order;
      next[index - 1].order = temp;
      // Swap positions
      [next[index], next[index - 1]] = [next[index - 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleMoveDown = (index: number) => {
    if (index === statuses.length - 1) return;
    setStatuses((prev) => {
      const next = [...prev];
      // Swap order values
      const temp = next[index].order;
      next[index].order = next[index + 1].order;
      next[index + 1].order = temp;
      // Swap positions
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    updateConfig.mutate(
      { statuses, defaultColor },
      {
        onSuccess: () => {
          toast.success("Status configuration saved");
          setHasChanges(false);
        },
        onError: (err) => {
          toast.error(`Failed to save: ${err.message}`);
        },
      }
    );
  };

  const handleFetchStatuses = () => {
    fetchStatuses.mutate(undefined, {
      onSuccess: (result) => {
        if (result.unmapped.length > 0) {
          toast.info(`Found ${result.unmapped.length} unmapped Jira statuses: ${result.unmapped.join(", ")}`);
        } else {
          toast.success(`All ${result.fetched} Jira statuses are mapped`);
        }
      },
      onError: (err) => {
        toast.error(`Failed to fetch: ${err.message}`);
      },
    });
  };

  const handleJiraMappingChange = (index: number, mapping: string[]) => {
    handleStatusChange(index, "jiraMapping", mapping);
  };

  const handleAddStatus = () => {
    const maxOrder = Math.max(...statuses.map(s => s.order), 0);
    const newStatus: StatusConfig = {
      name: "New Status",
      color: null,
      order: maxOrder + 1,
      isCompleted: false,
      isDefault: false,
      filter: null,
      jiraMapping: [],
    };
    setStatuses(prev => [...prev, newStatus]);
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
      <div className="text-destructive">Failed to load status configuration</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">Default Color</label>
          <p className="text-xs text-muted-foreground mb-2">
            Applied to statuses without a custom color
          </p>
          <Select value={defaultColor} onValueChange={handleDefaultColorChange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_OPTIONS.filter((c) => c.value !== USE_DEFAULT_VALUE).map((color) => (
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
          <Button variant="outline" onClick={handleAddStatus}>
            <Plus className="h-4 w-4 mr-2" />
            Add Status
          </Button>
          <Button
            variant="outline"
            onClick={handleFetchStatuses}
            disabled={fetchStatuses.isPending}
          >
            {fetchStatuses.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Fetch from Jira
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || updateConfig.isPending}>
            {updateConfig.isPending ? (
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
              <TableHead className="w-[100px]">Filter</TableHead>
              <TableHead className="w-[150px]">Color</TableHead>
              <TableHead className="min-w-[200px]">Jira Mapping</TableHead>
              <TableHead className="w-[70px] text-center">Done</TableHead>
              <TableHead className="w-[70px] text-center">Default</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statuses.map((status, index) => (
              <TableRow key={status.name}>
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
                      disabled={index === statuses.length - 1}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    value={status.name}
                    onChange={(e) => handleStatusChange(index, "name", e.target.value)}
                    className="h-8 font-medium"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={status.filter || ""}
                    onChange={(e) => handleStatusChange(index, "filter", e.target.value || null)}
                    placeholder="None"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={status.color || USE_DEFAULT_VALUE}
                    onValueChange={(v) => handleStatusChange(index, "color", v === USE_DEFAULT_VALUE ? null : v)}
                  >
                    <SelectTrigger className="w-full h-8">
                      <SelectValue placeholder="Use Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            {color.value !== USE_DEFAULT_VALUE && (
                              <div className={`w-4 h-4 rounded ${color.value}`} />
                            )}
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <TagInput
                    tags={status.jiraMapping || []}
                    onChange={(mapping) => handleJiraMappingChange(index, mapping)}
                    placeholder="Add Jira status..."
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={status.isCompleted}
                    onCheckedChange={(checked) =>
                      handleStatusChange(index, "isCompleted", !!checked)
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={status.isDefault || false}
                    onCheckedChange={(checked) =>
                      handleStatusChange(index, "isDefault", !!checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteStatus(index)}
                    disabled={status.isDefault}
                    title={status.isDefault ? "Cannot delete default status" : "Delete status"}
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
          <strong>Filter:</strong> Groups statuses into tabs on the dashboard (empty = not in any filter tab)
        </p>
        <p>
          <strong>Jira Mapping:</strong> Jira statuses that should use this status's color, filter, and order. Press Enter to add.
        </p>
        <p>
          <strong>Done:</strong> Tasks with these statuses (and their mappings) appear in the Completed page
        </p>
        <p>
          <strong>Default:</strong> Unmapped Jira statuses inherit this status's filter and color
        </p>
      </div>
    </div>
  );
}
