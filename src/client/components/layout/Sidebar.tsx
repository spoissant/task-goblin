import { NavLink } from "react-router";
import { cn } from "@/client/lib/utils";
import { useUnreadCountQuery } from "@/client/lib/queries";
import {
  ListTodo,
  SquareCheck,
  FolderSearch,
  CheckCircle,
  ScrollText,
  Settings,
  ListChecks,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

const navItems = [
  { to: "/", icon: ListChecks, label: "Tasks" },
  { to: "/todos", icon: SquareCheck, label: "Todos" },
  { to: "/completed", icon: CheckCircle, label: "Completed" },
  { to: "/curate", icon: FolderSearch, label: "Curate" },
  { to: "/logs", icon: ScrollText, label: "Logs", showBadge: true },
  { to: "/settings", icon: Settings, label: "Settings" },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const { data: unreadData } = useUnreadCountQuery();
  const unreadCount = unreadData?.count ?? 0;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 h-full bg-card border-r border-border transition-all duration-200 overflow-hidden",
          isCollapsed ? "w-16 px-3 py-4" : "w-64 p-4"
        )}
      >
        <div className={cn("mb-8 flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
          {!isCollapsed && (
            <h1 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
              <ListTodo className="h-6 w-6" />
              <span>Task Goblin</span>
            </h1>
          )}
          <button
            onClick={onToggle}
            className="size-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        <nav className={cn("space-y-1", isCollapsed && "flex flex-col items-center")}>
          {navItems.map((item) => {
            const linkContent = (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md text-sm font-medium transition-colors relative",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    isCollapsed ? "px-3 py-2 justify-center" : "w-full px-3 py-2"
                  )
                }
              >
                <span className="relative">
                  <item.icon className="h-4 w-4" />
                  {item.showBadge && unreadCount > 0 && isCollapsed && (
                    <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                {!isCollapsed && (
                  <>
                    {item.label}
                    {item.showBadge && unreadCount > 0 && (
                      <span className="ml-auto bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5">
                        {unreadCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                    {item.showBadge && unreadCount > 0 && ` (${unreadCount})`}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
