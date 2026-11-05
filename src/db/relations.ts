import { relations } from "drizzle-orm";
import { tasks, repositories, goals } from "./schema";

export const tasksRelations = relations(tasks, ({ one }) => ({
  repository: one(repositories, {
    fields: [tasks.repositoryId],
    references: [repositories.id],
  }),
  goal: one(goals, {
    fields: [tasks.goalId],
    references: [goals.id],
  }),
}));
