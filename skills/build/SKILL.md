---
name: build
description: Build — build the next ready change task or exploration with no person, and write the evidence for review. Use when a person asks to build a task or an exploration, to run a queue, or when a scheduled run starts.
---

# Build

This skill builds one change task or one exploration in each run. No person watches the run. Do not ask questions. When you need a decision, use the stop rule.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub. It gives the path of each repository. When a repository of the work is not in `repos/` and the hub has `mars.yaml`, run `npx @dean0x/mars clone`.

**State machine.** `.claude/state-machine.md` gives each status, who changes it, and what to do at each change of status. Follow it.

## 1. Pick the work

- When the request names a change task or an exploration, take it. Its status must be `ready`, or `building` when the request says that a worker claimed it for this run. If it is not, say the status, and stop.
- In all other cases, take a change task by the rule of "Build" in the state machine. When no change task is ready, take the `ready` exploration with the lowest number.

When no item is ready, say `Nothing to build`, and stop.

Set the status to `building`.

## 2. Read

Read these files:

- The change task or `exploration.md`. Its `## Context changes` apply to this work.
- Each decision in its `decisions`.
- `context/glossary.md`, and the files in `context/rules/` that are about the work.
- `CLAUDE.md` of each repository in `repos`. It tells you how to write the code and how to run the checks.
- `## Rework` of the task, when it has one. Triage wrote it. Each item links a comment or a check of a pull request in `pull_requests`. Read each one.
- For a change task with an `exploration`, its `exploration.md` and its artifacts. Use the artifacts as a reference for the change.

## 3. Build

### A change task

1. In each repository in `repos`, work on the branch `task/<id>`. When it is checked out, use it. Otherwise run `git fetch origin`, then check out `task/<id>` when it exists from an earlier run, or make it from `origin/<default branch>`.
2. Make the change that the task gives. Do only that change.
3. Write an automated check for each acceptance criterion. Use the test tools of the repository.
4. When you see other work that is necessary, write it under `## Discovered work`. Do not do it.
5. In a task with `## Rework`, make each change that the section gives, on the same branch. After the push in step 7, reply on each comment that an item links, with what changed. Send each reply as its own command, with no shell function or loop, so that the permission rules match it: `gh api repos/<owner>/<repo>/pulls/<number>/comments/<comment id>/replies -f body='<reply>'` for a review comment, and `gh pr comment <url> --body '<reply>'` for a comment on the conversation. Then write each item under `## Evidence` with what changed, and remove `## Rework`.

### An exploration

1. Write all the work in the folder of the exploration.
2. Build or try only what `## How to find out` gives. Do not make it ready for production.
3. You can read the code in the repositories. Do not change the repositories.
4. When you learn a fact that a future task must know, write it under `## Context changes`.

## 4. Stop rule

In an exploration, make each decision yourself, and write it under `## Evidence`.

In a change task, when the work needs a decision that the task, its decisions, the rules and its exploration do not give:

- If the decision changes what the product does for its users or for other systems, or changes stored data, stop. Write the question under `## Questions`. Commit the work on the branch, and push it. Set the status to `blocked`. End the run.
- If the decision changes only how the code is written, make the decision. Write it and its reason under `## Evidence`. When future tasks must follow the same decision, write it under `## Context changes` too.

## 5. Run the checks

For a change task, run each check that `CLAUDE.md` of the repository gives. If it gives no checks, write that under `## Evidence`.

- When a check fails, fix the code. Try a maximum of three times.
- When the check still fails, write the failure under `## Evidence`. Commit the work on the branch, and push it. Set the status to `blocked`. End the run.
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
2. When the branch has no pull request, open one to the default branch. When it has one, update its body (`gh pr edit --body`). The title is the id and the title of the task. The body has the goal, the result of each criterion, the screenshots as links to the hub on GitHub, and the items under `## Context changes` and `## Discovered work` of the task, under the same headings. Do not open it as a draft. Write the URL of each pull request in `pull_requests` of the task.
3. Commit the task file and the screenshots in the hub. Set the status to `review`.

## Hand back

One line: the id, the status, and the reason when the status is `blocked`.
