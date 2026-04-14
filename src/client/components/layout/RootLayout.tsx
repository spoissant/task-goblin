import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/client/components/ui/sonner";
import { cn } from "@/client/lib/utils";
import { useRealtimeUpdates } from "@/client/lib/useRealtimeUpdates";
import { useLocalStorage } from "@/client/lib/useLocalStorage";

export function RootLayout() {
  useRealtimeUpdates();

  const [isCollapsed, setIsCollapsed] = useLocalStorage("sidebar-collapsed", false);

  const toggleCollapsed = () => setIsCollapsed((prev) => !prev);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <Sidebar isCollapsed={isCollapsed} onToggle={toggleCollapsed} />
        <main
          className={cn(
            "flex-1 p-6 min-w-0 overflow-x-hidden transition-all duration-200",
            isCollapsed ? "ml-16" : "ml-64",
          )}
        >
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
