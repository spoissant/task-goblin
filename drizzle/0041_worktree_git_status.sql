-- Task worktree git status, refreshed on GitHub sync: uncommitted files and commits not on any remote
ALTER TABLE tasks ADD COLUMN uncommitted_files INTEGER;
ALTER TABLE tasks ADD COLUMN unpushed_commits INTEGER;
