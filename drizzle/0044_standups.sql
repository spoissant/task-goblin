-- Standup summaries generated from the Standup page by `claude -p /standup`.
CREATE TABLE IF NOT EXISTS `standups` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `state` text NOT NULL,
  `markdown` text,
  `error` text,
  `cost_usd` real,
  `duration_ms` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
