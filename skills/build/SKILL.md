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

In a change task with a pull request, run triage first (see "Triage"). It can add items to `## Rework`.

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
3. Write an automated test for each acceptance criterion that describes a behaviour. Use the test tools of the repository. Do not write a test for how a page looks, for a static page or for a config file. Prove those criteria with a screenshot, the output of a command or the changed file.
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
- Each acceptance criterion, with its proof (a test, a screenshot, an output or a file), and the result.
- Each decision that you made about the code, with its reason.
- When the change shows something to a person, a screenshot of each page and each state that changed. Take them with a headless browser. Save them in the hub in `tasks/T-<id>/`, and show each one as an image (step 7).

For a change task, write `## Deployment requirements` again on each build, a rework too, and add the section before `## Questions` when the task has none. Read the whole diff of each branch against the default branch, not only the changes of this run. Write each thing that a person does before or after the merge, so that the change works on staging and on production:

- Each environment variable that is new, renamed, removed or required now: its name, what its value is, and where it comes from. Read the validation of the environment (for example `start/env.ts`) and `.env.example`.
- Each secret, and the command that sets it on each environment.
- Each migration, and if the deploy runs it.
- Each outside service to set up or change: a webhook, an OAuth app, a DNS record, a token, a channel.
- Each command to run once, for example an import or a backfill.

For each item, say the environment (staging, production or both) and the order (before the merge, before the deploy, or after it). Keep the items that probe wrote. When there is nothing to do, write `None.`

For an exploration, write these items under `## Evidence`:

- What you built or tried, and the path of each artifact.
- What you learned, as an answer to the question.
- How a person can see it or run it.

## 7. Finish

In a change task with a pull request, run triage again before you push (see "Triage").

1. For a change task, commit the work on the branch, and push the branch: `git -C repos/<name> push origin task/<id>`. Push only `task/<id>` to a repository of the product, never its default branch. Do not merge.
2. When the task has screenshots, commit them in the hub, and push the hub as the state machine gives for a change of status. The commit of the push is the `<commit>` of their images.
3. When the branch has no pull request, open one to the default branch. When it has one, update its body (`gh pr edit --body`). The title is the id and the title of the task. The body has the goal, `## Deployment requirements` of the task right after it, the result of each criterion, the screenshots, and the items under `## Context changes` and `## Discovered work` of the task, under the same headings. Do not open it as a draft. Write the URL of each pull request in `pull_requests` of the task.
   - Show each screenshot as an image, so that the person sees it in the pull request: `![<page and state>](https://github.com/<owner>/<hub>/raw/<commit>/tasks/T-<id>/<file>)`. `<owner>/<hub>` is the GitHub repository of the hub (`git -C <hub folder> remote get-url origin`). A link to a file is not enough.
   - Put a line above each image that names the page, the state and the width.
4. Commit the task file in the hub. Set the status to `review`.

## Triage

Run the triage skill as a subagent. Give it this request: `Use the triage skill for <id>. It runs inside a build.` Add the command that prints the changes and the command that reports a fault, from your request. Wait for its hand back.

- When triage wrote a question under `## Questions`, use the stop rule.
- When triage wrote new items under `## Rework`, read each item and the comment or the check that it links. Do each item by step 3. Run the checks by step 5, and update the evidence by step 6.
- When triage handed back a way out other than `nothing`, run triage again. When it hands back `nothing`, go on.

## Hand back

One line: the id, the status, and the reason when the status is `blocked`.
