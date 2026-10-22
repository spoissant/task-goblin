import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { DevStackOverlay } from "./DevStackOverlay";
import { Toaster } from "@/client/components/ui/sonner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { useRealtimeUpdates } from "@/client/lib/useRealtimeUpdates";
import { useLocalStorage } from "@/client/lib/useLocalStorage";

export function RootLayout() {
  useRealtimeUpdates();

  const [isCollapsed, setIsCollapsed] = useLocalStorage("sidebar-collapsed", false);

  const toggleCollapsed = () => setIsCollapsed((prev) => !prev);

  // Radix tooltips need a provider above them; this one serves every page.
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <div className="flex">
          <Sidebar isCollapsed={isCollapsed} onToggle={toggleCollapsed} />
          <main
            className={cn(
              // clip, not hidden: hidden makes <main> a scroll container, which breaks sticky headers.
              "flex-1 p-6 min-w-0 overflow-x-clip transition-all duration-200",
              isCollapsed ? "ml-16" : "ml-64",
            )}
          >
            <Outlet />
          </main>
        </div>
        <DevStackOverlay />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
