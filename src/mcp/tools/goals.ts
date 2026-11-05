import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, patch, put, del, toolResult } from "../client.js";
import type { Goal, GoalListItem, ListResponse } from "@/shared/types";

/** Move tasks one by one; if one fails, the error says how many had already moved. */
async function assignTasks(taskIds: number[], goalId: number | null): Promise<number[]> {
  const moved: number[] = [];
  for (const id of taskIds) {
    try {
      await patch(`/api/v1/tasks/${id}`, { goalId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Task ${id}: ${message} (already moved: ${moved.length ? moved.join(", ") : "none"})`);
    }
    moved.push(id);
  }
  return moved;
}

const epicKeysSchema = z
  .array(z.string())
  .describe(
    "Jira epic keys (e.g. PS-123) tied to the goal: unassigned tasks in these epics join it now and whenever they sync. " +
      "An epic belongs to one goal. Tasks already in a goal are never moved by this."
  );

export function registerGoalTools(server: McpServer) {
  // list_goals
  server.registerTool(
    "list_goals",
    {
      description:
        "List the goals tasks are grouped under on the Tasks page, in display order, each with its shared context and " +
        "progress (taskCount, doneCount). Active goals by default; archived=true lists the archived ones instead. " +
        "To see a goal's tasks, call list_tasks with goalId.",
      inputSchema: {
        archived: z.boolean().optional().describe("When true, list archived goals instead of active ones"),
      },
    },
    ({ archived }) => toolResult(() => get<ListResponse<GoalListItem>>(`/api/v1/goals${archived ? "?archived=true" : ""}`))
  );

  // create_goal
  server.registerTool(
    "create_goal",
    {
      description:
        "Create a goal, a section grouping tasks on the Tasks page. It goes last in the display order. " +
        "Pass taskIds to move those tasks into it at once. Returns { goal, moved }, moved being the task IDs now in the goal.",
      inputSchema: {
        name: z.string().describe("Goal name"),
        context: z
          .string()
          .optional()
          .describe("Shared brief for the AI sessions of the goal's tasks (stored; not injected into prompts yet)"),
        taskIds: z.array(z.number().int()).optional().describe("Tasks to move into the new goal"),
        epicKeys: epicKeysSchema.optional(),
      },
    },
    ({ name, context, taskIds, epicKeys }) =>
      toolResult(async () => {
        const goal = await post<Goal>("/api/v1/goals", { name, context, epicKeys });
        const moved = taskIds?.length ? await assignTasks(taskIds, goal.id) : [];
        return { goal, moved };
      })
  );

  // update_goal
  server.registerTool(
    "update_goal",
    {
      description:
        "Update a goal. Only the fields you pass change; returns the goal. Archiving hides its section and keeps its tasks " +
        "assigned; archived=false brings it back. context replaces the whole shared brief; null clears it.",
      inputSchema: {
        id: z.number().int().describe("Goal ID (see list_goals)"),
        name: z.string().optional().describe("New goal name"),
        context: z.string().nullable().optional().describe("New shared context; null clears it"),
        archived: z.boolean().optional().describe("Archive or restore the goal"),
        epicKeys: epicKeysSchema.optional().describe("Replaces the goal's whole epic list; [] unties every epic"),
      },
    },
    ({ id, name, context, archived, epicKeys }) =>
      toolResult(() => {
        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (context !== undefined) updates.context = context;
        if (archived !== undefined) updates.archived = archived;
        if (epicKeys !== undefined) updates.epicKeys = epicKeys;
        return patch<Goal>(`/api/v1/goals/${id}`, updates);
      })
  );

  // delete_goal
  server.registerTool(
    "delete_goal",
    {
      description:
        "Permanently delete a goal. Its tasks are not deleted: they become unassigned. " +
        "To hide a goal without losing it, archive it with update_goal instead.",
      inputSchema: { id: z.number().int().describe("Goal ID") },
    },
    ({ id }) =>
      toolResult(async () => {
        await del(`/api/v1/goals/${id}`);
        return { deleted: id };
      })
  );

  // reorder_goals
  server.registerTool(
    "reorder_goals",
    {
      description:
        "Set the order of the goals' sections on the Tasks page: the given goal IDs, first to last. " +
        "Pass every active goal; goals left out keep their old position values and may sort oddly. Returns the new list.",
      inputSchema: { ids: z.array(z.number().int()).describe("Goal IDs in the order to show them") },
    },
    ({ ids }) =>
      toolResult(async () => {
        await put("/api/v1/goals/order", { ids });
        return get<ListResponse<GoalListItem>>("/api/v1/goals");
      })
  );

  // move_tasks_to_goal
  server.registerTool(
    "move_tasks_to_goal",
    {
      description:
        "Move tasks into a goal, or out of it: goalId null makes them unassigned. A task belongs to one goal at most, " +
        "so moving it replaces its previous goal. Tasks are moved in order; if one fails, the error lists the ones already moved. " +
        "Returns { goalId, moved }.",
      inputSchema: {
        taskIds: z.array(z.number().int()).min(1).describe("Task IDs to move"),
        goalId: z.number().int().nullable().describe("Target goal ID (see list_goals); null for unassigned"),
      },
    },
    ({ taskIds, goalId }) => toolResult(async () => ({ goalId, moved: await assignTasks(taskIds, goalId) }))
  );
}
