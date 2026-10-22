import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { ColumnCells, ColumnHeads, SUMMARY_COLUMNS } from "./columns";
import { getPrUrl } from "@/client/lib/links";
import type { TaskDetail } from "@/shared/types";

interface TaskSummaryBarProps {
  task: TaskDetail;
  jiraHost?: string;
}

export function TaskSummaryBar({ task, jiraHost }: TaskSummaryBarProps) {
  // Context for column renderers (linkToTask = false since we're on the detail page)
  const columnContext = {
    repo: task.repository,
    jiraHost,
    prUrl: getPrUrl(task.repository, task.prNumber),
    linkToTask: false,
  };

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <ColumnHeads columns={SUMMARY_COLUMNS} />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <ColumnCells task={task} columns={SUMMARY_COLUMNS} context={columnContext} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
