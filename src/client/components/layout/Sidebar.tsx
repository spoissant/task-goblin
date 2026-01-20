import { NavLink } from "react-router";
import { cn } from "@/client/lib/utils";
import { useUnreadCountQuery } from "@/client/lib/queries";
import { LayoutDashboard, ListTodo, SquareCheck, FolderSearch, CheckCircle, ScrollText, Settings } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/todos", icon: SquareCheck, label: "Todos" },
  { to: "/completed", icon: CheckCircle, label: "Completed" },
  { to: "/curate", icon: FolderSearch, label: "Curate" },
  { to: "/logs", icon: ScrollText, label: "Logs", showBadge: true },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { data: unreadData } = useUnreadCountQuery();
  const unreadCount = unreadData?.count ?? 0;

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-card border-r border-border p-4">
      <div className="mb-8">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ListTodo className="h-6 w-6" />
          Task Goblin
        </h1>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {item.showBadge && unreadCount > 0 && (
              <span className="ml-auto bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5">
                {unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
