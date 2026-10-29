# Lavish review in the browser

Shared by the chores that get a plan or a worklist approved in the browser: `/chore-start-task`, `/chore-continue-work`, `/chore-code-review-my-pr` and `/chore-address-pr-comments`. Each names its artifact, the playbooks to read and its terminal fallback.

- Run the globally installed `lavish-axi` binary, never `npx -y lavish-axi`, even where Lavish's own help suggests it. When it is not on `PATH`, use the skill's terminal fallback.
- The artifact lives in `.lavish/` at the repository root; add `.lavish/` to `.git/info/exclude` when it is missing. Only open HTML you generated.
- Read the playbooks the skill names (`lavish-axi playbook <id>`) before writing the HTML.
- Open it with `lavish-axi <file>`, then wait for feedback with `lavish-axi poll <file>` through Bash `run_in_background`.
- An annotation is a directive for the element it sits on. Apply it, update the HTML (Lavish live-reloads), and answer with `lavish-axi poll <file> --agent-reply "<what changed>"`, which also waits for the next feedback.
- A form never submits natively: the artifact is sandboxed, so a native submit navigates the frame away and the page says "no longer current". Every `<form>` needs `onsubmit="event.preventDefault(); …"` that collects the answers with `FormData`, calls `window.lavish.queuePrompt(<one summary of every choice>, { tag: '<name>' })` once, then `window.lavish.sendQueuedPrompts()` so the submit button reaches the agent without a second click.
- Approval can come from the browser or from the terminal.
- When the work is done, answer with a summary (`lavish-axi reply <file> --agent-reply "<summary>"`) and end the session with `lavish-axi end <file>`.
