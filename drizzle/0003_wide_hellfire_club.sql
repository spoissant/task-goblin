ALTER TABLE `todos` ADD `position` integer;

-- Backfill: assign sequential positions by createdAt
UPDATE todos SET position = (
  SELECT COUNT(*) FROM todos t2 WHERE t2.created_at <= todos.created_at AND t2.id <= todos.id
);