---
name: probe
description: Probe — grill the person about a change task until each decision that the build needs is settled, and record the decisions in the task. Use when a change task has the status `draft`, `probing` or `blocked`, when a person answers the questions of a task, or when a person asks if a task is ready to build.
---

# Probe

This skill interviews the person about one change task until you both understand it the same way. Then the build can run with no person. This skill does not change code. It does not make a decision for the person. It does not probe an exploration.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub.

## 1. Read the task

Read the task in `tasks/` that the request names. When the request names no task, list each task with the status `draft`, `probing` or `blocked`, and ask which one.

When the status is not `draft`, `probing` or `blocked`, tell the person the status, and stop. Set the status to `probing`.

Read the context of the task:

- Each decision in `decisions` of the task.
- `context/glossary.md`, and the files in `context/rules/` that are about the task.
- When the task has an `exploration`, its `exploration.md` and its artifacts.
- The code that the task changes or uses.

## 2. Map the design tree

Map the task as a design tree. Each decision that the build needs is a branch. Each decision opens the decisions that depend on it.

Ask the person only about decisions that change what the product does for its users or for other systems, or that change stored data. The build makes the decisions about how to write the code.

Finding facts is your job, not the job of the person. When a branch needs a fact from the code, the docs, or a system that the task names, send a sub-agent to find it. Do not ask the person for a fact that you can find.

Test each branch with concrete cases. Make up a case that is at the edge of the decision, and see if the task says what happens.

## 3. Ask in rounds

The frontier is each open decision whose prerequisites are settled. Ask the whole frontier in one round. Give a number to each question, and give your recommended answer. Word each question so that "yes" accepts your answer.

```
❓ **Q1** - **<question title>**: <question body, with choices when they help>

➡️ <your recommended answer>
```

A question that depends on a question that is still open goes in a later round. When a fact is still being found, ask the questions that do not depend on it. Then wait for the answers.

## 4. Record the answers

After each round, write each answer in the task:

- Under `## Questions`: `- [x] Q<number>: <the question>`, and the answer under it.
- Change the goal, the criteria or `## Out of scope` as the answer tells you.
- When a future task must know the answer, write it under `## Context changes`.

Then find the new frontier, and ask the next round.

## 5. Finish

The task is ready when the frontier is empty: you visited each branch of the tree, and you assumed nothing. Before you set the status, check the task:

- Each criterion can be proved by an automated check.
- The task gives one change. When it gives more than one, tell the person to split it.
- Each term is in `context/glossary.md`.

Ask the person to confirm that you both understand the task the same way. When they confirm, set the status to `ready`.

When the person stops before the frontier is empty, write each open question under `## Questions` as `- [ ] Q<number>: <the question>`, with your recommended answer. Keep the status `probing`.

## A blocked task

The build sets `blocked` and writes its questions under `## Questions`. Start the tree from those questions and from the code on the branch of the task. Then do steps 3 to 5.

## Hand back

- The status of the task.
- Each decision that you settled, in one line.
- Each open question, by number.
