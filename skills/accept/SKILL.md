---
name: accept
description: Accept — review a built change task or exploration with a person, and record the result. For an accepted change task, promote the facts that future tasks must know. Use when a change task or an exploration has the status `review`, or when a person asks to review the work of the factory.
---

# Accept

This skill helps a person review one change task or one exploration. Only an accepted change task changes `context/`. Only this skill and the person change `context/`.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub. It gives the path of each repository.

## 1. Pick the work

When the request names no item, list each change task and exploration with the status `review`, and ask which one.

## 2. An exploration

Show the question, what the build learned, and the path of each artifact. Ask the person to look at the artifacts.

Ask the person to choose:

- **The findings answer the question.** Write the answer under `## Findings`. Ask which findings a future task must know, and write them under `## Context changes`. Set the status to `done`. Tell the person to give the exploration to `intake` when they want change tasks from it.
- **The findings do not answer the question.** Ask the person to change the question or `## How to find out`. Set the status to `ready`.
- **Discard it.** Write the reason under `## Review`. Set the status to `discarded`.

Do not change `context/`. Do not delete the artifacts. Stop.

## 3. A change task

### Show the evidence

Show:

- The goal.
- Each acceptance criterion, with its evidence.
- Each decision that the build made about the code.
- The discovered work.
- For each repository in `repos`, the output of `git diff --stat <default branch>...task/<id>`. Show the full diff only when the person asks for it.

### Record the result

Ask the person to accept or to reject the task. Write the result and the reason under `## Review`.

- When the person rejects the task, ask what to do next. To build again with the same task, set the status to `ready`. To change the task first, set the status to `draft`. Stop.
- When the person accepts the task, ask if you must merge the branches. Merge only when the person says yes.

### Promote

Show each item under `## Context changes` in one list. The person can accept, change or drop each item.

Write each accepted item to `context/`:

- For a new decision, copy `references/decision.md` to `context/decisions/<number>-<slug>.md`. Use the next free number.
- For all other items, change the text in the file that the item names.

List the items that you wrote under `## Promoted`.

When a new decision replaces an old decision, set the status of the old decision to `replaced by <number>`.

### Finish

1. Add each item under `## Discovered work` to `inbox.md`, with the id of the task.
2. Set the status to `done`.
3. When the task has an `exploration`, and each change task with that `exploration` is `done`, set the status of the exploration to `consumed`.

## Hand back

- The result.
- Each file that you wrote or changed.
