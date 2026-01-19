import { relations } from "drizzle-orm";
import {
  tasks,
  todos,
  branches,
  repositories,
  pullRequests,
  jiraItems,
  blockedBy,
} from "./schema";

export const tasksRelations = relations(tasks, ({ many }) => ({
  todos: many(todos),
  branches: many(branches),
  jiraItems: many(jiraItems),
  blockedBy: many(blockedBy),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  task: one(tasks, {
    fields: [todos.taskId],
    references: [tasks.id],
  }),
  branch: one(branches, {
    fields: [todos.branchId],
    references: [branches.id],
  }),
  jiraItem: one(jiraItems, {
    fields: [todos.jiraItemId],
    references: [jiraItems.id],
  }),
  pullRequest: one(pullRequests, {
    fields: [todos.pullRequestId],
    references: [pullRequests.id],
  }),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  task: one(tasks, {
    fields: [branches.taskId],
    references: [tasks.id],
  }),
  repository: one(repositories, {
    fields: [branches.repositoryId],
    references: [repositories.id],
  }),
  pullRequest: one(pullRequests, {
    fields: [branches.pullRequestId],
    references: [pullRequests.id],
  }),
}));

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  branches: many(branches),
  pullRequests: many(pullRequests),
}));

export const pullRequestsRelations = relations(pullRequests, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [pullRequests.repositoryId],
    references: [repositories.id],
  }),
  branches: many(branches),
}));

export const jiraItemsRelations = relations(jiraItems, ({ one }) => ({
  task: one(tasks, {
    fields: [jiraItems.taskId],
    references: [tasks.id],
  }),
}));

export const blockedByRelations = relations(blockedBy, ({ one }) => ({
  // What is blocked
  blockedTask: one(tasks, {
    fields: [blockedBy.blockedTaskId],
    references: [tasks.id],
  }),
  blockedBranch: one(branches, {
    fields: [blockedBy.blockedBranchId],
    references: [branches.id],
  }),
  // What is blocking
  blockerTask: one(tasks, {
    fields: [blockedBy.blockerTaskId],
    references: [tasks.id],
  }),
  blockerTodo: one(todos, {
    fields: [blockedBy.blockerTodoId],
    references: [todos.id],
  }),
  blockerBranch: one(branches, {
    fields: [blockedBy.blockerBranchId],
    references: [branches.id],
  }),
}));

export {
  tasksRelations as taskRelations,
  todosRelations as todoRelations,
  branchesRelations as branchRelations,
  repositoriesRelations as repositoryRelations,
  pullRequestsRelations as pullRequestRelation,
  jiraItemsRelations as jiraItemRelation,
  blockedByRelations as blockedByRelation,
};
