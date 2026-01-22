import { useState, useMemo } from "react";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { Plus } from "lucide-react";

export function TasksPage() {
  const [activeFilter, setActiveFilter] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data: statusSettings } = useStatusSettingsQuery();

  // Build filter tabs from configured filters, ordered by position
  const filterTabs = useMemo(() => {
    const tabs: { value: string; label: string }[] = [
      { value: "", label: "All" },
    ];

    if (statusSettings?.filters) {
      // Filters are already sorted by position from the API
      for (const filter of statusSettings.filters) {
        tabs.push({ value: filter.name, label: filter.name });
      }
    }

    return tabs;
  }, [statusSettings?.filters]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      <Tabs value={activeFilter} onValueChange={setActiveFilter} className="mb-6">
        <TabsList>
          {filterTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <TaskTable activeFilter={activeFilter || undefined} />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}
