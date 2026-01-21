import { useState, useEffect } from "react";
import {
  useStatusConfigQuery,
  useUpdateStatusConfig,
  useFetchJiraStatuses,
} from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
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
import { ArrowUp, ArrowDown, RefreshCw, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { StatusConfig } from "@/client/lib/types";

const USE_DEFAULT_VALUE = "__default__";

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
      next[index] = { ...next[index], [field]: value };
      return next;
    });
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
        toast.success(`Fetched ${result.fetched} statuses, added ${result.added} new`);
        setHasChanges(false);
      },
      onError: (err) => {
        toast.error(`Failed to fetch: ${err.message}`);
      },
    });
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

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-[180px]">Color</TableHead>
              <TableHead className="w-[100px] text-center">Completed</TableHead>
              <TableHead className="w-[100px] text-center">Selectable</TableHead>
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
                <TableCell className="font-medium">{status.name}</TableCell>
                <TableCell>
                  <Select
                    value={status.color || USE_DEFAULT_VALUE}
                    onValueChange={(v) => handleStatusChange(index, "color", v === USE_DEFAULT_VALUE ? null : v)}
                  >
                    <SelectTrigger className="w-full">
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
                    checked={status.isSelectable}
                    onCheckedChange={(checked) =>
                      handleStatusChange(index, "isSelectable", !!checked)
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          <strong>Completed:</strong> Tasks with these statuses appear in the Completed page
        </p>
        <p>
          <strong>Selectable:</strong> These statuses are available when creating/editing manual tasks
        </p>
      </div>
    </div>
  );
}
