---
name: triage
description: Triage — read the pull requests of a change task in review or blocked after they change, choose the way out, and act on it. Use when the watcher script starts it, or when a person asks what a pull request of a task needs.
---

# Triage

This skill reads the pull requests of one change task in `review` or `blocked`, and chooses the way out, as a person who looks at a pull request does. No person watches the run. Do not ask questions in the session. Ask on the pull request.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub.

**State machine.** `.claude/state-machine.md` gives each status, who changes it, and what to do at each change of status. Follow it. Its section "Triage" gives the ways out.

## 1. Read

Inside a build, run the command that the request gives before you read. It prints the changes. When it prints nothing, hand back `nothing`, and stop. Write no comment.

1. Read the task that the request names. Its status must be `review` or `blocked`. Inside a build, it must be `building`. If it is not, say the status, and stop.
2. Read each decision in its `decisions`, and the files in `context/rules/` that are about the work.
3. For each pull request in `pull_requests` of the task, or of `task/<id>` when the list is empty, read:
   - the diff: `gh pr diff <url>`;
   - each review, each comment on the conversation, and each review thread that is not resolved: `gh pr view <url> --comments`, and `gh api repos/<owner>/<repo>/pulls/<number>/comments`;
   - the checks: `gh pr checks <url>`. For each failed check, read its log: `gh run view <run id> --log-failed`;
   - the merge state: `gh pr view <url> --json mergeable`.
4. Read your comments of the earlier triages on the pull request. They start with `**Triage**`. Do not answer the same thing two times.
5. When a check or a review fails for a cause that the task does not explain, read the file names in `tasks/`. Open each task that is not `done` and is about the same failure. When one of them fixes the cause, give its id in the report and in the comment.

The request gives the changes since the last triage. Choose the way out for these changes. Use the rest as context.

## 2. Choose the way out

**A task in `blocked`.** It waits on the open questions under `## Questions`, and the person can answer one on the pull request. For each comment of the person that answers an open question, tick the question and write the answer under it: `- Answer: <the answer> (the person, on the pull request: <the link of the comment>, <date>).` Write what the answer asks into `## Rework`. When every question is answered, set the status to `ready`. When a comment of the person does not answer a question clearly, reply in its thread with what is still open, and keep the status `blocked`. Each other change of a blocked task takes a way out below, and the status stays `blocked` while a question is open.

For each change, choose one way out of the table in the state machine:

- **Rework:** a request to change the code of the task, a check that fails because of the code of the task, or a merge conflict.
- **Answer:** a question about the work.
- **New work:** a request for work that the task does not give.
- **A decision of the person:** a request that changes what the product does for its users or for other systems, or changes stored data, when the task, its decisions and the rules do not settle it.
- **A fault outside the task:** a check or a review that fails for a cause outside the code of the task, for example a missing setting of the repository or a fault of the runner.
- **Nothing to do:** for example a comment that only agrees, or a review with no findings.

When the changes give two or more ways out, do each of them.

## 3. Act

- **Rework:** write `## Rework` in the task, before `## Evidence`. Write one item for each change: what to change, and the link of the comment or the check. Set the status to `ready`.
- **Answer:** reply in the thread of the comment. For a review comment, use `gh api repos/<owner>/<repo>/pulls/<number>/comments/<comment id>/replies -f body='<reply>'`. For a comment on the conversation, use `gh pr comment <url> --body '<reply>'`.
- **New work:** reply that it is new work. Write it under `## Discovered work` of the task.
- **A decision of the person:** ask the question on the pull request. Write it under `## Questions` of the task. Set the status to `blocked`. When there is also rework, write `## Rework` too. The build does it after the question is settled, by probe or by the person's answer on the pull request.
- **A fault outside the task:** open a new issue with the command that the request gives: what failed, and the cause. Open one issue for each fault, and do not comment on an earlier issue.
- **Nothing to do:** nothing.

Send each command on its own, with no shell function or loop, so that the permission rules match it. Do not change the code. Do not push a branch.

When you changed the task and the status stays `review` or `blocked`, commit the task, and push the hub as the state machine gives for a change of status. When the push is rejected, fetch, rebase on the default branch, and push again.

## 4. Finish

Write one comment on each pull request: `**Triage**: <the way out>. <the reason, in one or two sentences>.`

For a rework and for a decision of the person, end the comment with: `The pull request is a draft until the build hands it back. Do not merge it before then.` The worker makes it a draft at its next poll.

## Inside a build

Build runs this skill as a subagent, and the request says so. Do the steps above, with these differences:

- Do not change the status. The build changes it.
- For a rework, write the items under `## Rework`. When the task has `## Rework`, add the items to it.
- For a decision of the person, write the question under `## Questions`.
- Do not commit the task, and do not push the hub. The build does it.

## Hand back

One line: the id, the way out, and the status.
