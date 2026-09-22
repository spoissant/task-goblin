import { relations } from "drizzle-orm";
import {
  tasks,
  todos,
  repositories,
  worktrees,
  taskWorktrees,
  claudeSessions,
} from "./schema";

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  todos: many(todos),
  repository: one(repositories, {
    fields: [tasks.repositoryId],
    references: [repositories.id],
  }),
  worktree: one(taskWorktrees, {
    fields: [tasks.id],
    references: [taskWorktrees.taskId],
  }),
  sessions: many(claudeSessions),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  task: one(tasks, {
    fields: [todos.taskId],
    references: [tasks.id],
  }),
}));

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  tasks: many(tasks),
  worktrees: many(worktrees),
}));

export const worktreesRelations = relations(worktrees, ({ one }) => ({
  repository: one(repositories, {
    fields: [worktrees.repositoryId],
    references: [repositories.id],
  }),
}));

export const taskWorktreesRelations = relations(taskWorktrees, ({ one }) => ({
  task: one(tasks, {
    fields: [taskWorktrees.taskId],
    references: [tasks.id],
  }),
  repository: one(repositories, {
    fields: [taskWorktrees.repositoryId],
    references: [repositories.id],
  }),
}));

export const claudeSessionsRelations = relations(claudeSessions, ({ one }) => ({
  task: one(tasks, {
    fields: [claudeSessions.taskId],
    references: [tasks.id],
  }),
}));
