import { TableCell, TableHead } from "@/client/components/ui/table";
import { Flame, ListTree, MessageSquare, Snowflake } from "lucide-react";
import type { Task, Repository, ClaudeSession } from "@/shared/types";
import type { ChoreEntry } from "@/shared/chores";
import { parseChangesByCategory } from "@/shared/file-categories";
import { InteractiveStatusBadge } from "../InteractiveStatusBadge";
import { ChecksStatusCell } from "../ChecksStatusCell";
import { IconTip, UnresolvedCommentsIcon } from "../StatusIcons";
import { DeploymentBadges } from "../DeploymentBadges";
import { DevQaButton } from "../DevQaButton";
import { ChangesSummary } from "../ChangesSummary";
import { AiCell } from "./AiCell";
import { SyncCell } from "./SyncCell";
import { OnIceCell } from "./OnIceCell";
import {
  TypeCell,
  SprintCell,
  ParentCell,
  KeyCell,
  TitleCell,
  RepoCell,
  BranchCell,
  PrCell,
  ReviewsCell,
  HighPriorityCell,
  IsParentCell,
} from "./cells";

// Column definition type
interface ColumnDef {
  key: string;
  header: React.ReactNode;
  width?: string;
  cellClassName?: string;
  render: (task: Task, context: ColumnContext) => React.ReactNode;
}

interface ColumnContext {
  repo?: Repository | null;
  jiraHost?: string | null;
  prUrl?: string | null;
  linkToTask?: boolean; // Whether title should link to task detail
  completed?: boolean; // Completed tasks: no Assign buttons or dev stack toggle
  nextChore?: ChoreEntry;
  session?: ClaudeSession; // latest AI session for the task
  isParent?: boolean; // task has sub-tasks or child issues
  onSearch?: (query: string) => void; // replace the page's search query
}

// Shared Column Definitions
const COLUMNS = {
  highPriority: {
    key: "highPriority",
    header: <IconTip icon={Flame} tip="High Priority" />,
    width: "40px",
    render: (task) => <HighPriorityCell task={task} />,
  },
  onIce: {
    key: "onIce",
    header: <IconTip icon={Snowflake} tip="On Ice (blocked)" />,
    width: "40px",
    render: (task) => <OnIceCell task={task} />,
  },
  isParent: {
    key: "isParent",
    header: <IconTip icon={ListTree} tip="Has / is sub-task" />,
    width: "56px",
    render: (task, ctx) => <IsParentCell task={task} isParent={ctx.isParent} onSearch={ctx.onSearch} />,
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
    render: (task, ctx) => <KeyCell task={task} jiraHost={ctx.jiraHost} canAssign={!ctx.completed} />,
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
    render: (task, ctx) => <RepoCell task={task} repo={ctx.repo} devStack={!ctx.completed} />,
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
    render: (task, ctx) => <PrCell task={task} prUrl={ctx.prUrl} canAssign={!ctx.completed} />,
  },
  changes: {
    key: "changes",
    header: "Changes",
    width: "100px",
    render: (task) => (
      <ChangesSummary
        changedFiles={task.changedFiles}
        additions={task.additions}
        deletions={task.deletions}
        changesByCategory={parseChangesByCategory(task.changesByCategory)}
      />
    ),
  },
  status: {
    key: "status",
    header: "Status",
    width: "100px",
    render: (task) => (
      <div className="flex flex-wrap items-center gap-1">
        <InteractiveStatusBadge taskId={task.id} status={task.status} jiraKey={task.jiraKey} />
        <DevQaButton task={task} />
      </div>
    ),
  },
  mergedIn: {
    key: "mergedIn",
    header: "Merged in",
    width: "100px",
    render: (task) => (
      <DeploymentBadges
        branches={task.onDeploymentBranches}
        labelOnlyBranches={task.labelOnlyDeploymentBranches}
        deployedBranches={task.deployedOnBranches}
      />
    ),
  },
  checks: {
    key: "checks",
    header: "Checks",
    width: "50px",
    render: (task, ctx) => <ChecksStatusCell checksStatus={task.checksStatus} checksDetails={task.checksDetails} prUrl={ctx.prUrl} />,
  },
  reviews: {
    key: "reviews",
    header: "Reviews",
    width: "120px",
    render: (task, ctx) => <ReviewsCell task={task} prUrl={ctx.prUrl} />,
  },
  comments: {
    key: "comments",
    header: <IconTip icon={MessageSquare} tip="Pull Request Comments" />,
    width: "50px",
    render: (task, ctx) => <UnresolvedCommentsIcon count={task.unresolvedCommentCount} prUrl={ctx.prUrl} />,
  },
  ai: {
    key: "ai",
    header: "AI",
    width: "120px",
    render: (task, ctx) => <AiCell task={task} session={ctx.session} nextChore={ctx.nextChore} />,
  },
  sync: {
    key: "sync",
    header: "",
    width: "40px",
    render: (task) => <SyncCell task={task} />,
  },
} as const satisfies Record<string, ColumnDef>;

export type ColumnKey = keyof typeof COLUMNS;

// Type helper to access columns with full ColumnDef interface
function getColumn(key: ColumnKey): ColumnDef {
  return COLUMNS[key];
}

/** The header cells of a column list. */
export function ColumnHeads({ columns }: { columns: ColumnKey[] }) {
  return (
    <>
      {columns.map((key) => {
        const col = getColumn(key);
        return (
          <TableHead key={col.key} style={col.width ? { width: col.width } : undefined}>
            {col.header}
          </TableHead>
        );
      })}
    </>
  );
}

/** A task's cells for a column list. */
export function ColumnCells({ task, columns, context }: { task: Task; columns: ColumnKey[]; context: ColumnContext }) {
  return (
    <>
      {columns.map((key) => {
        const col = getColumn(key);
        return (
          <TableCell key={col.key} className={col.cellClassName}>
            {col.render(task, context)}
          </TableCell>
        );
      })}
    </>
  );
}

// Column order for TaskTable (main tasks list)
export const TABLE_COLUMNS: ColumnKey[] = [
  "type",
  "sprint",
  "epic",
  "key",
  "highPriority",
  "onIce",
  "isParent",
  "status",
  "title",
  "ai",
  "sync",
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
export const SUMMARY_COLUMNS: ColumnKey[] = [
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

// Column order for the Completed page
export const COMPLETED_COLUMNS: ColumnKey[] = [
  "sync",
  "type",
  "epic",
  "key",
  "status",
  "title",
  "repo",
  "branch",
  "pr",
  "checks",
  "reviews",
];
