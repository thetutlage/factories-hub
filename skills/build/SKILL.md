---
name: build
description: Build — build the next ready change task or exploration with no person, and write the evidence for review. Use when a person asks to build a task or an exploration, to run a queue, or when a scheduled run starts.
---

# Build

This skill builds one change task or one exploration in each run. No person watches the run. Do not ask questions. When you need a decision, use the stop rule.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub. It gives the path of each repository.

## 1. Pick the work

- When the request names a change task or an exploration, take it. Its status must be `ready`. If it is not, say the status, and stop.
- When the request names a queue, take the work from that queue only.
- In all other cases, take a change task. When no change task is ready, take an exploration.

In a queue:

- A change task is ready when its status is `ready` and each task in its `depends_on` is `done`.
- An exploration is ready when its status is `ready`.
- Take the ready item with the lowest number.

When no item is ready, say `Nothing to build`, and stop.

Set the status to `building`.

## 2. Read

Read these files:

- The change task or `exploration.md`. Its `## Context changes` apply to this work.
- Each decision in its `decisions`.
- `context/glossary.md`, and the files in `context/rules/` that are about the work.
- `CLAUDE.md` of each repository in `repos`. It tells you how to write the code and how to run the checks.
- The pull request of `task/<id>` in each repository, when it exists (`gh pr list --head task/<id>`). Read each review comment that is not resolved. Fix each one, or reply with the reason when you do not fix it.
- For a change task with an `exploration`, its `exploration.md` and its artifacts. Use the artifacts as a reference for the change.

## 3. Build

### A change task

1. In each repository in `repos`, make a branch `task/<id>` from the default branch. If the branch exists from an earlier run, use it.
2. Make the change that the task gives. Do only that change.
3. Write an automated check for each acceptance criterion. Use the test tools of the repository.
4. When you see other work that is necessary, write it under `## Discovered work`. Do not do it.

### An exploration

1. Write all the work in the folder of the exploration.
2. Build or try only what `## How to find out` gives. Do not make it ready for production.
3. You can read the code in the repositories. Do not change the repositories.
4. When you learn a fact that a future task must know, write it under `## Context changes`.

## 4. Stop rule

In an exploration, make each decision yourself, and write it under `## Evidence`.

In a change task, when the work needs a decision that the task, its decisions, the rules and its exploration do not give:

- If the decision changes what the product does for its users or for other systems, or changes stored data, stop. Write the question under `## Questions`. Commit the work on the branch. Set the status to `blocked`. End the run.
- If the decision changes only how the code is written, make the decision. Write it and its reason under `## Evidence`. When future tasks must follow the same decision, write it under `## Context changes` too.

## 5. Run the checks

For a change task, run each check that `CLAUDE.md` of the repository gives. If it gives no checks, write that under `## Evidence`.

- When a check fails, fix the code. Try a maximum of three times.
- When the check still fails, write the failure under `## Evidence`. Set the status to `blocked`. End the run.
- Do not change a check, skip a test or remove a test to make it pass.

## 6. Write the evidence

For a change task, write these items under `## Evidence`:

- The branch and the pull request in each repository.
- The changes, in a maximum of five lines.
- Each acceptance criterion, with the check that proves it, and the result.
- Each decision that you made about the code, with its reason.
- When the change shows something to a person, a screenshot of each page and each state that changed. Take them with a headless browser. Save them in the hub in `tasks/T-<id>/`, and give the path of each one.

For an exploration, write these items under `## Evidence`:

- What you built or tried, and the path of each artifact.
- What you learned, as an answer to the question.
- How a person can see it or run it.

## 7. Finish

1. For a change task, commit the work on the branch, and push the branch. Do not merge.
2. When the branch has no pull request, open one to the default branch. The title is the id and the title of the task. The body has the goal, the result of each criterion, and the screenshots as links to the hub on GitHub. Do not open it as a draft.
3. Set the status to `review`. Commit the task file and the screenshots in the hub, and push the hub.

## Hand back

One line: the id, the status, and the reason when the status is `blocked`.
