import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/client/components/ui/sonner";

export function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6 ml-64 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
