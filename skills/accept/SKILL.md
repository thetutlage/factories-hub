---
name: accept
description: Accept — review a built change task or exploration with a person, and record the result. For an accepted change task, promote the facts that future tasks must know. Use when a change task or an exploration has the status `review`, or when a person asks to review the work of the factory.
---

# Accept

This skill helps a person review one change task or one exploration. Only an accepted change task changes `context/`. Only this skill and the person change `context/`.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub. It gives the path of each repository.

**Issues.** When the hub has `scripts/sync-issues.mjs`, run `node scripts/sync-issues.mjs <id>` after each change to the status of a change task. It updates the GitHub issue of the task: its text, its `status:` label, and closed or open.

## 1. Pick the work

When the request names no item, list each change task and exploration with the status `review`, and ask which one.

When the request says that the person merged each pull request of a change task, go to [Accepted by merge](#accepted-by-merge).

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
- The pull request in each repository in `repos`, with its review comments that are still open. The person reads the diff on GitHub.

### Record the result

Ask the person to accept or to reject the task. Write the result and the reason under `## Review`.

- When the person rejects the task, ask what to do next. To build again, ask the person to write the changes as review comments on the pull request, and set the status to `ready`. The next build reads them. To change the task first, set the status to `draft`. Stop.
- When the person accepts the task, ask if you must merge the pull requests. Merge only when the person says yes, with `gh pr merge --squash`. Then pull the default branch in each repository.

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

## Accepted by merge

The factory worker starts this part when each pull request of a change task in `review` is merged. No person watches it. Do not ask questions.

1. The status must be `review`. If it is not, say the status, and stop.
2. Under `## Review`, write `Accepted by merge on <date>`, and the link of each pull request.
3. Do the steps of [Promote](#promote). Write each item under `## Context changes` as it is written. The person read the items in the body of the pull request, and the merge accepted them.
4. Do the steps of [Finish](#finish).
5. Commit the hub, and push it: `git push origin HEAD:main`. When the push is rejected, run `git fetch origin` and `git rebase origin/main`, then push again.

## Hand back

- The result.
- Each file that you wrote or changed.
