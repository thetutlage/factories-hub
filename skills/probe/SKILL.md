---
name: probe
description: Probe — find each thing that a change task leaves unsettled, and settle it with the person before the build. Use when a change task has the status `draft`, `probing` or `blocked`, when a person answers the questions of a task, or when a person asks if a task is ready to build.
---

# Probe

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub.

**State machine.** `.claude/state-machine.md` gives each status, who changes it, and what to do at each change of status. Follow it.

Read the task in `tasks/` that the request names. When the request names no task, list each task with the status `draft`, `probing` or `blocked`, and ask which one. When the status is not one of these, say the status, and stop. Set the status to `probing`.

## Settle the task

Read the task, and the code and the systems that it uses. Find each thing that the task leaves unsettled, and settle it. Do not assume.

- A criterion about how a page looks points to the design. When it gives a size, a colour, a spacing or a position, change it to point to the design.

- When the change needs something on staging or production that is known now, such as an environment variable, a secret or an outside service, write it under `## Deployment requirements`. Add the section before `## Questions` when the task has none. The build adds the rest.

- When the code or the docs settle it, read them. Do not ask the person.
- Ask the person about the rest in one group. Give each question a number and your recommended answer:

  ```
  🔸 **Q1** - **<title>**: <the question>

  👉 <your recommended answer>
  ```

- Write each answer in the task. When an answer opens a new question, ask it in the next group.

When a build or triage set the task to `blocked`, start from its questions under `## Questions`.

**The agent of the build.** Before the task is ready, ask the person which agent builds it, as the last question. The default is `build.provider` of `factory.json`. Another agent is a provider that `build.modes` names, with a model, for example `codex/gpt-6.1-sol`. Recommend the default, unless the person said which agent builds this kind of task. Write the answer in `provider:` of the task. Leave `provider:` empty for the default.

The task is ready when nothing is unsettled. Set the status to `ready`.

## Hand back

- The status of the task.
- Each open question, by number.
