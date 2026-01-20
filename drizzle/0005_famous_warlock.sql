-- Set existing nulls to 0 (schema default handles new inserts via Drizzle ORM)
UPDATE `tasks` SET `unresolved_comment_count` = 0 WHERE `unresolved_comment_count` IS NULL;
