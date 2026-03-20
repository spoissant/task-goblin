import { relations } from "drizzle-orm";
import {
  tasks,
  todos,
  repositories,
  worktrees,
  notes,
  noteTasks,
} from "./schema";

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  todos: many(todos),
  noteTasks: many(noteTasks),
  repository: one(repositories, {
    fields: [tasks.repositoryId],
    references: [repositories.id],
  }),
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

export const notesRelations = relations(notes, ({ many }) => ({
  noteTasks: many(noteTasks),
}));

export const noteTasksRelations = relations(noteTasks, ({ one }) => ({
  note: one(notes, {
    fields: [noteTasks.noteId],
    references: [notes.id],
  }),
  task: one(tasks, {
    fields: [noteTasks.taskId],
    references: [tasks.id],
  }),
}));
