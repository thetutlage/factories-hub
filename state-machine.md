# The state machine

This file is the only place for the states of the factory and the rules that move work between them. The skills and the scripts follow it. Do not write these rules again in a skill or a script.

## Change task

| Status | Meaning |
| --- | --- |
| `draft` | The task is written. It has open questions. |
| `probing` | The person and probe settle the questions. |
| `ready` | Nothing is open. A build can take it. |
| `building` | A factory machine claimed it, and a build runs. |
| `review` | The pull request is open, and the person reviews it. |
| `blocked` | A build or triage needs a decision of the person. The question is under `## Questions`. |
| `accepting` | Each pull request is merged, and accept runs. |
| `done` | Accepted. The issue is closed. |
| `discarded` | The person dropped the task. The issue is closed. |

| From | To | Who | Where |
| --- | --- | --- | --- |
| an input | `draft` | intake | the laptop of the person |
| `draft`, `blocked` | `probing` | probe | the laptop of the person |
| `probing` | `ready` | probe | the laptop of the person |
| `ready` | `building` | the builder script, when it claims the task | a factory machine |
| `building` | `review` | build | a factory machine |
| `building` | `blocked` | build | a factory machine |
| `review` | `ready` | triage, for rework | a factory machine |
| `review` | `blocked` | triage | a factory machine |
| `blocked` | `ready` | triage, when the person answers each question on the pull request | a factory machine |
| `review` | `accepting` | the watcher script, when each pull request is merged | a factory machine |
| `review` | `draft` | the watcher script, when a pull request is closed with no merge | a factory machine |
| `accepting` | `done` | accept | a factory machine |
| `review` | `done` | accept, run by the person | the laptop of the person |
| each status | `discarded` | the person | anywhere |

## Each change of status

1. Commit the task file, and push the hub. Give the hub's folder, the folder with `tasks/`, to each git command: `git -C <hub folder> push origin HEAD:main`. When the push is rejected, run `git -C <hub folder> fetch origin` and `git -C <hub folder> rebase origin/main`, then push again. Do not push again without the rebase. Never run these commands in a folder of `repos/`: there, `HEAD:main` pushes the branch of the task to `main` of that repository.
2. When the hub has `scripts/sync-issues.mjs`, run `node scripts/sync-issues.mjs <id>`. The issue gets the label `status: <status>`. It is closed at `done` and `discarded`.

## The factory identity

Build, triage and accept on a factory machine use the factory identity on GitHub, not the account of the person. They push, open pull requests and reply with it. The person reviews its pull requests as a reviewer.

## Build

- Build takes the `ready` task with a `## Rework` section first. Then it takes the `ready` task with the lowest number, with each task in its `depends_on` at `done`.
- Build opens one pull request in each repository of the task, and writes its URL in `pull_requests` of the task.
- The body of the pull request has the items under `## Context changes` and `## Discovered work`. A merge accepts the task and these items.
- In a task with `## Rework`, build makes each change that the section gives, on the same branch and pull request.
- In a task with a pull request, build runs triage as a subagent when it starts, and again before it hands the task back. When a triage writes `## Rework`, build does it, and runs triage again. Build pushes and hands the task back only when a triage finds no change.
- Build pushes only `task/<id>` to a repository of the product, never its default branch. The default branch changes only when the person merges a pull request.
- Build does not wait for the checks on GitHub. It runs the checks of the repository, pushes, and sets the status. The watcher script gives each check result to triage.
- When a build session ends with the task still `building` in the hub, the worker looks at the hub commits of the build folder that are not on the default branch. When each of them changes only the task's file or its screenshots, and sets a status other than `building`, the worker pushes them and syncs the issue. A session that may not push the default branch, such as Codex in `auto-review`, ends this way. Anything else is reported, and the person decides.

## The watcher script

The watcher script looks at the pull requests of each task in `review`, and of each task in `blocked`.

- When each pull request is merged, it sets the task to `accepting`, and starts accept. Accept promotes the items in the body of the pull request, and sets the task to `done`.
- When a pull request is closed with no merge, it sets the task to `draft`, and reports it in a new issue in the fleet repository.
- When a pull request of a task in `blocked` has a change since the last triage, it starts triage too. The person can answer a question on the pull request; triage writes the answer under `## Questions`, and sets `ready` when each question is answered.
- When a triage or a build session ends before it pushed its hand-back, the worker pushes it: the hub commits of its folder that change only the task, rebased on the default branch.
- When a pull request has a change since the last triage, it starts triage on the pull request. A change is a new review, a new comment, a new commit, a new result of a check, or a merge conflict. A change that a person makes while the task is `ready` or `building` counts at the next triage. A submitted review starts triage at the next poll. Each other change starts it when it is 5 minutes old, so that a person can write several comments.

## Drafts

The worker keeps the draft state of each open pull request of a task in step with the status of the task, at each poll. While the task is `ready`, `building` or `blocked`, its pull requests are drafts, so GitHub turns off the merge button while the factory reworks the task or waits on the person. While the task is in `review`, they are ready for review. A pull request that becomes a draft or ready is not a change for the watcher script.

## Triage

Triage reads the pull request and its task, and chooses one way out. Then it acts.

| Way out | What triage does |
| --- | --- |
| Rework | Writes the changes under `## Rework` of the task, with the links of the comments. Sets the task to `ready`. |
| Answer | Replies on the pull request. The task stays in `review`. |
| New work | Replies on the pull request. Writes the work under `## Discovered work` of the task. The task stays in `review`. |
| A decision of the person | Asks on the pull request, and writes the question under `## Questions`. Sets the task to `blocked`. |
| A fault outside the task, for example a review that cannot run | Reports it in a new issue in the fleet repository. The task stays in `review`. |
| Nothing to do | Nothing. |

Each triage ends with one comment on the pull request. It gives the way out and the reason. For a rework and for a decision of the person, the comment also says that the pull request is a draft until the build hands it back.

### Triage inside a build

The request of the build gives the command that prints the changes since the last triage. The command records the start of this triage, so the watcher does not triage the same changes again. Triage takes each change at once, with no 5-minute wait.

Triage does each action of the table, with these differences:

- It does not change the status. For a rework, it writes `## Rework`, and build does it. For a decision of the person, it writes the question under `## Questions`, and build sets `blocked`.
- When the command prints no change, triage writes no comment.

## Exploration

| From | To | Who |
| --- | --- | --- |
| an input | `ready` | intake |
| `ready` | `building` | build |
| `building` | `review` | build |
| `review` | `done`, `ready` or `discarded` | accept, run by the person |
| `done` | `consumed` | accept, when each change task of the exploration is `done` |

An exploration has no pull request and no issue.
