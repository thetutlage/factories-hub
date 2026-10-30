---
name: intake
description: Intake — take any input for the product and turn it into work that the factory can do. The input can be an idea, a bug report, a customer issue, a maintenance job, a quality problem, or a done exploration. Use when a person brings new work, picks an item from the inbox, or wants to turn an exploration into change tasks.
---

# Intake

This skill turns one input into change tasks, into an exploration, or into one line in the inbox. It finds what is missing before the work can be built. It does not change code or `context/`.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub.

## 1. Read the context

Read these files:

- `context/positioning.md`
- `context/glossary.md`
- `context/non-goals.md`

Read the file names in `context/decisions/`, `context/rules/`, `tasks/` and `explorations/`. Open a file only when its name is about the input.

## 2. Understand the input

When the input is the id of an exploration, go to [From an exploration](#from-an-exploration).

1. Write the input again in one or two sentences. Ask the person if it is correct.
2. When a change task or an exploration for the same work exists and is not `done`, tell the person its id, and stop.
3. When the input is against the positioning or a non-goal, tell the person which line it is against. Ask the person to choose:
   - Drop the input. Stop.
   - Make an exception for this input only. Write the line and the reason under `## Questions` of the task, as a question with its answer. Continue.
   - Change the line. Write the change under `## Context changes`. Tell the person about each task that is not `done` and that is against the new text. Continue.
4. When the input only changes the positioning or a non-goal, and gives no other work, tell the person to change `context/` directly. Stop.

You can read the code in the repositories to understand the input. Do not change the code.

## 3. Find what is missing

Look for what the factory must know before it can build the work. For each gap, use one of these:

| What is missing                                                    | What to do                     |
| ------------------------------------------------------------------ | ------------------------------ |
| A decision that only the person can make                           | Ask the person now. When a future task must know the answer, write it under `## Context changes`. |
| Knowledge that only building can give, for example how it looks, if it works, or how much work it is | Write an exploration |
| Nothing                                                            | Write a change task            |

When you ask questions:

- Ask a maximum of three questions at one time.
- Ask what the product must do. Do not ask how to write the code.
- Use the words of the glossary. When the person uses a term that is not in the glossary, ask for its meaning. Write the term and its meaning under `## Context changes`.

Do not look for each edge case. `probe` does that later.

## 4. Not now

When the person says that the work is not for now, add one line to `inbox.md`, and stop.

## 5. Write the work

### A change task

Copy `references/change.md` to `tasks/T-<number>-<slug>.md`. Use the next free number.

1. Write the goal in plain words. Write each acceptance criterion as one check.
2. For a fault, write the expected behavior, the actual behavior and the steps that cause the fault.
3. Write each open question under `## Questions`.
4. In `repos`, give the name of each repository that the task changes.
5. In `decisions`, give the number of each decision that applies. Do not copy the text of a decision.
6. Keep the task small. One task gives one change that a person can check. When the work gives two changes, write two tasks and set `depends_on`.
7. When the hub has `scripts/sync-issues.mjs`, run `node scripts/sync-issues.mjs <id>` for each change task that you wrote. It makes the GitHub issue of the task, with the label `status: draft`, and writes its URL in `issue`.

### An exploration

Make the folder `explorations/E-<number>-<slug>/`. Use the next free number. Copy `references/exploration.md` to `exploration.md` in that folder.

1. Write the one question that the exploration must answer.
2. Write what to build or to try to find the answer.
3. In `repos`, give the name of each repository that the build must read.
4. Do not write the change tasks yet. Write them from the exploration when it is `done`.

When the person gives a milestone, write it in `milestone`.

## From an exploration

1. Read `exploration.md` of the exploration. Its status must be `done`. If it is not, say the status, and stop.
2. Read its findings, its `## Context changes`, and its artifacts.
3. Do steps 3 to 5 of this skill. The findings and the artifacts answer some of the gaps. Ask only about the gaps that are left.
4. In each change task, write the id of the exploration in `exploration`.
5. Copy each item under `## Context changes` of the exploration to the change task that it applies to.

## Hand back

- Each change task and exploration that you wrote, with its status.
- The questions that are still open.
- The next skill: `probe` for a change task, `build` for an exploration.
