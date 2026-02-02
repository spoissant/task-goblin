-- Drop notes and instructions columns from tasks table
-- Data will be lost - use standalone notes table instead

ALTER TABLE tasks DROP COLUMN notes;
ALTER TABLE tasks DROP COLUMN instructions;
