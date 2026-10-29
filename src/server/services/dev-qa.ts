// The Dev QA chip: once the user has QA'd a ready Code Review task on its test
// env, move its ticket to Ready for Test.
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { DEV_QA_CATEGORY, READY_FOR_TEST, isDevQaReady } from "@/shared/dev-qa";
import { getStatusCategories, statusNamesOf } from "../lib/task-status";
import { AppError, NotFoundError } from "../lib/errors";
import { normalize, writeTask } from "./merge-gate";
import { getMergeJira } from "./merge-jira";

type TaskRow = typeof tasks.$inferSelect;

async function inDevQaCategory(status: string): Promise<boolean> {
  const category = (await getStatusCategories()).find((c) => c.name === DEV_QA_CATEGORY);
  return category ? statusNamesOf(category).includes(normalize(status)) : false;
}

/** Re-checks the step's conditions, then transitions the Jira ticket (a task without one just changes status). */
export async function moveToReadyForTest(taskId: number): Promise<TaskRow> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new NotFoundError("Task", taskId);
  if (!(await inDevQaCategory(task.status)) || !isDevQaReady(task)) {
    throw new AppError("Task is not ready for dev QA", 409, "NOT_DEV_QA_READY");
  }
  let status = READY_FOR_TEST;
  if (task.jiraKey) {
    const jira = getMergeJira();
    const { status: live, transitions } = await jira.issueTransitions(task.jiraKey);
    const toTest = transitions.find((t) => normalize(t.to) === normalize(READY_FOR_TEST));
    if (!toTest) throw new AppError(`No Jira transition to ${READY_FOR_TEST} from ${live}`, 409, "NO_TRANSITION");
    await jira.transition(task.jiraKey, toTest.id);
    status = toTest.to;
  }
  await writeTask(task.id, { status });
  return { ...task, status };
}
