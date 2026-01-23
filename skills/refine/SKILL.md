---
name: refine
description: Analyze a task and create implementation instructions. Use when user says "refine task", "plan task", "goblin refine", "analyze task", or wants to create instructions for a task ID/Jira key.
---

# Refine Task Instructions

Analyze a Task Goblin task and produce implementation instructions through planning.

## Workflow

### Step 1: Identify the Task

The user provides either:
- A numeric task ID (e.g., `42`)
- A Jira key (e.g., `AJ-1234`)

If unclear, ask: "Which task should I refine? Provide a task ID or Jira key."

### Step 2: Fetch the Task

Use `mcp__task-goblin__get_task` with either:
- `id` parameter for numeric IDs
- `jiraKey` parameter for Jira keys

### Step 3: Gather Context

From the task, extract:
- **title**: What needs to be done
- **description**: Detailed requirements
- **notes**: Additional context, constraints, or research
- **blockers**: Dependencies to consider

### Step 4: Enter Plan Mode

Use the `EnterPlanMode` tool to begin analysis. In plan mode:

1. **Understand the problem/feature**
   - Analyze the description and notes
   - Identify unclear requirements
   - Search codebase for related code

2. **Investigate the codebase**
   - Find relevant files and patterns
   - Understand existing architecture
   - Identify integration points

3. **Design the solution**
   - Break down into concrete steps
   - Identify files to create/modify
   - Consider edge cases and tests

4. **Write the plan**
   - Clear, actionable implementation steps
   - Specific file paths and changes
   - Test requirements

### Step 5: Get Plan Approval

Exit plan mode with `ExitPlanMode` to get user approval.

### Step 6: Save Instructions

Once the plan is approved, save it to the task:

```
mcp__task-goblin__update_task
  - id or jiraKey: [task identifier]
  - instructions: [approved plan in markdown]
```

The instructions should be formatted as actionable steps that `/goblin:execute` can follow.

## Instructions Format

Write instructions as clear, sequential steps:

```markdown
## Implementation Steps

1. **Create the service class**
   - File: `app/services/feature/my_service.rb`
   - Inherit from `ApplicationService`
   - Implement `call` method with [specific logic]

2. **Add the API endpoint**
   - File: `app/controllers/api/v1/feature_controller.rb`
   - Add `create` action
   - Use `MyService.call(params)`

3. **Write tests**
   - File: `spec/services/feature/my_service_spec.rb`
   - Test happy path
   - Test edge cases: [list them]

4. **Update documentation**
   - Add API docs to `docs/api/feature.md`
```
