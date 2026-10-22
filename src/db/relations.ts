import { relations } from "drizzle-orm";
import { tasks, repositories } from "./schema";

export const tasksRelations = relations(tasks, ({ one }) => ({
  repository: one(repositories, {
    fields: [tasks.repositoryId],
    references: [repositories.id],
  }),
}));
