import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { Flame, MessageSquare, Snowflake } from "lucide-react";
import type { Task, Repository } from "@/client/lib/types";
import type { ChoreEntry } from "@/client/lib/queries/chores";
import {
  TypeCell,
  SprintCell,
  ParentCell,
  KeyCell,
  TitleCell,
  RepoCell,
  BranchCell,
  PrCell,
  ChangesCell,
  StatusCell,
  MergedInCell,
  ChecksCell,
  ReviewsCell,
  CommentsCell,
  HighPriorityCell,
  OnIceCell,
  NextCell,
  getJiraUrl,
  getPrUrl,
} from "./cells";

// Re-export utilities and cells
export {
  TypeCell,
  SprintCell,
  ParentCell,
  KeyCell,
  TitleCell,
  RepoCell,
  BranchCell,
  PrCell,
  ChangesCell,
  StatusCell,
  MergedInCell,
  ChecksCell,
  ReviewsCell,
  CommentsCell,
  HighPriorityCell,
  OnIceCell,
  NextCell,
  getJiraUrl,
  getPrUrl,
};

// Column definition type
export interface ColumnDef<T extends Task = Task> {
  key: string;
  header: React.ReactNode;
  width?: string;
  cellClassName?: string;
  render: (task: T, context: ColumnContext) => React.ReactNode;
}

export interface ColumnContext {
  repo?: Repository;
  jiraHost?: string | null;
  prUrl?: string | null;
  linkToTask?: boolean; // Whether title should link to task detail
  nextChore?: ChoreEntry;
}

// Shared Column Definitions
export const COLUMNS = {
  highPriority: {
    key: "highPriority",
    header: (
      <Tooltip>
        <TooltipTrigger asChild>
          <Flame className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>High Priority</TooltipContent>
      </Tooltip>
    ),
    width: "40px",
    render: (task) => <HighPriorityCell task={task} />,
  },
  onIce: {
    key: "onIce",
    header: (
      <Tooltip>
        <TooltipTrigger asChild>
          <Snowflake className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>On Ice (blocked)</TooltipContent>
      </Tooltip>
    ),
    width: "40px",
    render: (task) => <OnIceCell task={task} />,
  },
  type: {
    key: "type",
    header: "Type",
    width: "80px",
    render: (task) => <TypeCell task={task} />,
  },
  sprint: {
    key: "sprint",
    header: "Sprint",
    width: "140px",
    cellClassName: "max-w-[140px] text-xs",
    render: (task) => <SprintCell task={task} />,
  },
  epic: {
    key: "epic",
    header: "Parent",
    width: "100px",
    render: (task, ctx) => <ParentCell task={task} jiraHost={ctx.jiraHost} />,
  },
  key: {
    key: "key",
    header: "Key",
    width: "100px",
    render: (task, ctx) => <KeyCell task={task} jiraHost={ctx.jiraHost} />,
  },
  title: {
    key: "title",
    header: "Title",
    width: undefined, // flex
    cellClassName: "max-w-[300px]",
    render: (task, ctx) => <TitleCell task={task} linkToTask={ctx.linkToTask} />,
  },
  repo: {
    key: "repo",
    header: "Repo",
    width: "120px",
    render: (_task, ctx) => <RepoCell repo={ctx.repo} />,
  },
  branch: {
    key: "branch",
    header: "Branch",
    width: "150px",
    cellClassName: "max-w-[150px]",
    render: (task) => <BranchCell task={task} />,
  },
  pr: {
    key: "pr",
    header: "PR",
    width: "60px",
    render: (task, ctx) => <PrCell task={task} prUrl={ctx.prUrl} />,
  },
  changes: {
    key: "changes",
    header: "Changes",
    width: "85px",
    render: (task) => <ChangesCell task={task} />,
  },
  status: {
    key: "status",
    header: "Status",
    width: "100px",
    render: (task) => <StatusCell task={task} />,
  },
  mergedIn: {
    key: "mergedIn",
    header: "Merged in",
    width: "100px",
    render: (task) => <MergedInCell task={task} />,
  },
  checks: {
    key: "checks",
    header: "Checks",
    width: "50px",
    render: (task, ctx) => <ChecksCell task={task} prUrl={ctx.prUrl} />,
  },
  reviews: {
    key: "reviews",
    header: "Reviews",
    width: "60px",
    render: (task, ctx) => <ReviewsCell task={task} prUrl={ctx.prUrl} />,
  },
  comments: {
    key: "comments",
    header: (
      <Tooltip>
        <TooltipTrigger asChild>
          <MessageSquare className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>Pull Request Comments</TooltipContent>
      </Tooltip>
    ),
    width: "50px",
    render: (task, ctx) => <CommentsCell task={task} prUrl={ctx.prUrl} />,
  },
  next: {
    key: "next",
    header: "Chores",
    width: "110px",
    render: (task, ctx) => <NextCell task={task} nextChore={ctx.nextChore} />,
  },
} as const satisfies Record<string, ColumnDef>;

// Type helper to access columns with full ColumnDef interface
export function getColumn(key: keyof typeof COLUMNS): ColumnDef {
  return COLUMNS[key];
}

// Column order for TaskTable (main tasks list)
export const TABLE_COLUMNS: (keyof typeof COLUMNS)[] = [
  "type",
  "sprint",
  "epic",
  "key",
  "highPriority",
  "onIce",
  "status",
  "title",
  "next",
  "repo",
  "branch",
  "pr",
  "changes",
  "mergedIn",
  "checks",
  "comments",
  "reviews",
];

// Column order for TaskSummaryBar (task detail page)
export const SUMMARY_COLUMNS: (keyof typeof COLUMNS)[] = [
  "type",
  "sprint",
  "epic",
  "key",
  "status",
  "title",
  "repo",
  "branch",
  "pr",
  "mergedIn",
  "checks",
  "comments",
  "reviews",
];
