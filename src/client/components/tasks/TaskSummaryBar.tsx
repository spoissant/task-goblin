import { TooltipProvider } from "@/client/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { SUMMARY_COLUMNS, getPrUrl, getColumn } from "./columns";
import type { TaskDetail, Repository } from "@/client/lib/types";

interface TaskSummaryBarProps {
  task: TaskDetail;
  repo?: Repository;
  jiraHost?: string;
}

export function TaskSummaryBar({ task, repo, jiraHost }: TaskSummaryBarProps) {
  const prUrl = getPrUrl(repo, task.prNumber);

  // Context for column renderers (linkToTask = false since we're on the detail page)
  const columnContext = {
    repo,
    jiraHost,
    prUrl,
    linkToTask: false,
  };

  return (
    <TooltipProvider>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {SUMMARY_COLUMNS.map((colKey) => {
                const col = getColumn(colKey);
                return (
                  <TableHead
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.header}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              {SUMMARY_COLUMNS.map((colKey) => {
                const col = getColumn(colKey);
                return (
                  <TableCell key={col.key} className={col.cellClassName}>
                    {col.render(task, columnContext)}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
