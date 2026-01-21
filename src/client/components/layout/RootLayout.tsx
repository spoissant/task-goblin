import { useState, useEffect } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/client/components/ui/sonner";
import { cn } from "@/client/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function RootLayout() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === "true";
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const toggleCollapsed = () => setIsCollapsed((prev) => !prev);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <Sidebar isCollapsed={isCollapsed} onToggle={toggleCollapsed} />
        <main
          className={cn(
            "flex-1 p-6 min-w-0 overflow-x-hidden transition-all duration-200",
            isCollapsed ? "ml-16" : "ml-64"
          )}
        >
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
