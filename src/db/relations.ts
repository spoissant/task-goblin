import { relations } from "drizzle-orm";
import {
  tasks,
  todos,
  repositories,
  worktrees,
  blockedBy,
  logs,
  notes,
  noteTasks,
} from "./schema";

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  todos: many(todos),
  blockedBy: many(blockedBy),
  logs: many(logs),
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

export const blockedByRelations = relations(blockedBy, ({ one }) => ({
  blockedTask: one(tasks, {
    fields: [blockedBy.blockedTaskId],
    references: [tasks.id],
    relationName: "blockedTask",
  }),
  blockerTask: one(tasks, {
    fields: [blockedBy.blockerTaskId],
    references: [tasks.id],
    relationName: "blockerTask",
  }),
  blockerTodo: one(todos, {
    fields: [blockedBy.blockerTodoId],
    references: [todos.id],
  }),
}));

export const logsRelations = relations(logs, ({ one }) => ({
  task: one(tasks, {
    fields: [logs.taskId],
    references: [tasks.id],
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
