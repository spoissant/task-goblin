import { useState, useMemo, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { BulkDeployResultsDialog } from "@/client/components/tasks/BulkDeployResultsDialog";
import { SortableTodoItem } from "@/client/components/todos/SortableTodoItem";
import {
  useTasksQuery,
  useRepositoriesQuery,
  useTodosQuery,
  useToggleTodo,
  useDeleteTodo,
  useReorderTodo,
  useCreateTodo,
} from "@/client/lib/queries";
import { useMarkAllLogsRead, useUnreadCountQuery } from "@/client/lib/queries/logs";
import { useBulkDeploy } from "@/client/lib/queries/deploy";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Plus, CheckCheck, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { BulkDeployResult, TaskWithTodos } from "@/client/lib/types";

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deployTargetBranch, setDeployTargetBranch] = useState("");
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [deployResults, setDeployResults] = useState<BulkDeployResult | null>(null);

  // Todo state
  const [showCompleted, setShowCompleted] = useState(false);
  const [groupByTask, setGroupByTask] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [isAddingTodo, setIsAddingTodo] = useState(false);
  const [todosCollapsed, setTodosCollapsed] = useState(false);
  const [selectedTodoTaskId, setSelectedTodoTaskId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: tasksData } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const bulkDeploy = useBulkDeploy();
  const markAllRead = useMarkAllLogsRead();
  const { data: unreadCount } = useUnreadCountQuery();

  // Todo queries
  const { data: todosData } = useTodosQuery();
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();
  const reorderTodo = useReorderTodo();
  const createTodo = useCreateTodo();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const remainingByTask = useMemo(() => {
    if (!groupByTask || !todosData?.items) return new Map<number, number>();
    const counts = new Map<number, number>();
    for (const todo of todosData.items) {
      if (todo.taskId && !todo.done) {
        counts.set(todo.taskId, (counts.get(todo.taskId) ?? 0) + 1);
      }
    }
    for (const [taskId, count] of counts) {
      counts.set(taskId, count - 1);
    }
    return counts;
  }, [groupByTask, todosData?.items]);

  const filteredTodos = useMemo(() => {
    if (!todosData?.items) return [];
    let todos = todosData.items;
    if (!showCompleted) {
      todos = todos.filter((todo) => !todo.done);
    }
    if (groupByTask) {
      const seenTasks = new Set<number>();
      todos = todos.filter((todo) => {
        if (!todo.taskId) return true;
        if (todo.done) return false;
        if (seenTasks.has(todo.taskId)) return false;
        seenTasks.add(todo.taskId);
        return true;
      });
    }
    return todos;
  }, [todosData?.items, showCompleted, groupByTask]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const newIndex = filteredTodos.findIndex((t) => t.id === over.id);
    if (newIndex === -1) return;
    const targetTodo = filteredTodos[newIndex];
    const newPosition = targetTodo.position ?? newIndex + 1;
    reorderTodo.mutate(
      { id: Number(active.id), position: newPosition },
      { onError: () => toast.error("Failed to reorder todo") }
    );
  };

  const handleToggle = (id: number) => {
    toggleTodo.mutate(id, { onError: () => toast.error("Failed to toggle todo") });
  };

  const handleDeleteTodo = (id: number) => {
    deleteTodo.mutate(id, { onError: () => toast.error("Failed to delete todo") });
  };

  const handleAddTodo = () => {
    if (!newTodo.trim()) return;
    createTodo.mutate(
      { content: newTodo.trim() },
      {
        onSuccess: () => {
          setNewTodo("");
          setIsAddingTodo(false);
        },
        onError: () => toast.error("Failed to create todo"),
      }
    );
  };

  const handleTodoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddTodo();
    else if (e.key === "Escape") {
      setNewTodo("");
      setIsAddingTodo(false);
    }
  };

  // Build task map for results dialog
  const taskMap = useMemo(() => {
    const map = new Map<number, TaskWithTodos>();
    if (tasksData?.items) {
      for (const task of tasksData.items) {
        map.set(task.id, task);
      }
    }
    return map;
  }, [tasksData?.items]);

  // Get selected tasks and their common repository
  const selectedTasks = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => taskMap.get(id))
      .filter((t): t is TaskWithTodos => !!t);
  }, [selectedIds, taskMap]);

  // Get deployment branches from the common repository (if all selected tasks share one)
  const deploymentBranches = useMemo(() => {
    if (selectedTasks.length === 0) return [];

    // Get unique repository IDs
    const repoIds = new Set(selectedTasks.map((t) => t.repositoryId).filter(Boolean));
    if (repoIds.size !== 1) return []; // Multiple repos - can't bulk deploy

    const repoId = Array.from(repoIds)[0];
    const repo = reposData?.items.find((r) => r.id === repoId);
    if (!(repo?.worktrees?.length) || !repo.deploymentBranches) return [];

    try {
      return JSON.parse(repo.deploymentBranches) as string[];
    } catch {
      return [];
    }
  }, [selectedTasks, reposData?.items]);

  const handleBulkDeploy = () => {
    if (!deployTargetBranch) {
      toast.error("Please select a target branch");
      return;
    }

    // Validate single repository
    const repoIds = new Set(selectedTasks.map((t) => t.repositoryId).filter(Boolean));
    if (repoIds.size > 1) {
      toast.error("All selected tasks must be from the same repository");
      return;
    }

    bulkDeploy.mutate(
      { taskIds: Array.from(selectedIds), targetBranch: deployTargetBranch },
      {
        onSuccess: (result) => {
          setDeployResults(result);
          setResultsDialogOpen(true);
          if (result.summary.success > 0 && result.summary.conflict === 0) {
            toast.success(`Deployed ${result.summary.success} task(s) to ${deployTargetBranch}`);
          }
          setSelectedIds(new Set());
          setDeployTargetBranch("");
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Deploy failed");
        },
      }
    );
  };

  return (
    <div>
      {/* Todos section */}
      {(filteredTodos.length > 0 || isAddingTodo) && (
        <div className="mb-4 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setTodosCollapsed(!todosCollapsed)}
              className="flex items-center gap-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
            >
              {todosCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Todos{todosData?.items && ` (${todosData.items.filter((t) => !t.done).length})`}
            </button>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-completed"
                  checked={showCompleted}
                  onCheckedChange={(checked) => setShowCompleted(checked === true)}
                />
                <Label htmlFor="show-completed" className="text-sm cursor-pointer">
                  Show completed
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="group-by-task"
                  checked={groupByTask}
                  onCheckedChange={(checked) => setGroupByTask(checked === true)}
                />
                <Label htmlFor="group-by-task" className="text-sm cursor-pointer">
                  Group by task
                </Label>
              </div>
              {!isAddingTodo && (
                <Button size="sm" variant="outline" onClick={() => setIsAddingTodo(true)}>
                  <Plus className="h-3 w-3 mr-1" />
                  New Todo
                </Button>
              )}
            </div>
          </div>

          {!todosCollapsed && (
            <>
              {isAddingTodo && (
                <div className="flex items-center gap-3 p-3 mb-2 rounded-md border bg-card">
                  <div className="w-4" />
                  <Checkbox disabled />
                  <Input
                    value={newTodo}
                    onChange={(e) => setNewTodo(e.target.value)}
                    onKeyDown={handleTodoKeyDown}
                    placeholder="Add a todo..."
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={handleAddTodo}
                    disabled={!newTodo.trim() || createTodo.isPending}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNewTodo("");
                      setIsAddingTodo(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredTodos.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-2">
                    {filteredTodos.map((todo) => (
                      <SortableTodoItem
                        key={todo.id}
                        todo={todo}
                        remainingCount={groupByTask && todo.taskId ? remainingByTask.get(todo.taskId) ?? 0 : 0}
                        onToggle={handleToggle}
                        onDelete={handleDeleteTodo}
                        isSelected={selectedTodoTaskId !== null && todo.taskId === selectedTodoTaskId}
                        onSelect={(todoId) => {
                          const clicked = filteredTodos.find((t) => t.id === todoId);
                          if (!clicked?.taskId || clicked.taskId === selectedTodoTaskId) {
                            setSelectedTodoTaskId(null);
                          } else {
                            setSelectedTodoTaskId(clicked.taskId);
                          }
                        }}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      )}

      {selectedIds.size > 0 ? (
        <div className="mb-4">
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deploymentBranches={deploymentBranches}
            targetBranch={deployTargetBranch}
            onTargetBranchChange={setDeployTargetBranch}
            onDeploy={handleBulkDeploy}
            onClearSelection={() => {
              setSelectedIds(new Set());
              setDeployTargetBranch("");
            }}
            isDeploying={bulkDeploy.isPending}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <RefreshButton />
          <Button
            variant="outline"
            onClick={() => markAllRead.mutate()}
            disabled={!unreadCount?.count || markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all as read
          </Button>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      )}

      <TaskTable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        titleFilter={debouncedQuery}
        highlightedTaskId={selectedTodoTaskId}
      />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />

      <BulkDeployResultsDialog
        open={resultsDialogOpen}
        onOpenChange={setResultsDialogOpen}
        results={deployResults}
        taskMap={taskMap}
      />
    </div>
  );
}
