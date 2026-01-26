---
name: execute
description: Execute task instructions from Task Goblin. Use when user says "execute task", "run task instructions", "goblin execute", or provides a task ID/Jira key to execute.
---

# Execute Task Instructions

Fetch and execute the instructions stored in a Task Goblin task.

## Workflow

### Step 1: Identify the Task

The user provides either:
- A numeric task ID (e.g., `42`)
- A Jira key (e.g., `AJ-1234`)

If unclear, ask: "Which task should I execute? Provide a task ID or Jira key."

### Step 2: Fetch the Task

Use `mcp__task-goblin__get_task` with either:
- `id` parameter for numeric IDs
- `jiraKey` parameter for Jira keys

### Step 3: Branch Setup

**If task has `headBranch`:**
1. `git checkout <headBranch>`
2. Failure → ABORT with: "Cannot checkout branch `<headBranch>`. Aborting."
3. `git pull` (optional, pull latest)

**If task has NO `headBranch`:**
1. Get default branch:
   ```bash
   git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||'
   ```
   - Works for any repo (returns `sprint`, `main`, `develop`, etc.)
   - If command fails → ABORT (repo must have origin/HEAD configured)
2. `git checkout <defaultBranch>`
3. `git pull`
4. Create new branch: Must include Jira key (e.g., `feat/<jiraKey>-<slug>`)
   - Check target repo's CLAUDE.md for naming convention, or use default pattern
5. Work from new branch

### Step 4: Validate Instructions

Check that `task.instructions` exists and is not empty.

If empty or missing:
> This task has no instructions defined. Would you like me to help refine the task first? Use `/goblin:refine` to analyze and create instructions.

You can also check `task.description` and `task.notes` for more context on the issue at hand.

### Step 5: Execute Instructions

The `instructions` field contains a markdown plan with implementation steps. Execute them as written:
- Follow the steps in order
- Use the appropriate tools for each step
- Track progress with TodoWrite

### Step 6: Save the implementation summary in the task's notes

- Generate a summary of the fix/implementation you just made
- Append this summary to the tasks's notes field