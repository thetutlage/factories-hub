# <Product> hub

This folder holds what the factory knows about <Product>. Run the agents in this folder. The code is in the repositories below.

## Repositories

| Name | Path |
| ---- | ---- |
|      |      |

## Files

| Path            | It holds                                                            | It changes                                    |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `context/`      | Positioning, glossary, rules, decisions, non-goals                  | Rarely. Only `accept` or a person changes it. |
| `inbox.md`      | Work that is not a task yet: ideas, deferred work, discovered work  | Often                                         |
| `tasks/`        | One file for each change task                                       | Each task stays, with its last status         |
| `explorations/` | One folder for each exploration: `exploration.md` and its artifacts | Each exploration stays, with its last status  |

## Two queues

The factory has two queues.

- A **change task** changes the product. Its work is on a branch in each repository. The branch is merged.
- An **exploration** builds something to answer a question. Its work is in its folder in `explorations/`. It does not change the repositories. Its artifacts stay, because they are progress.

A change task moves through these statuses:

`draft` → `probing` → `ready` → `building` → `review` → `done`

The build sets `blocked` when it stops. A person answers the questions of a blocked task. Then `probe` sets it to `ready`.

An exploration moves through these statuses:

`ready` → `building` → `review` → `done` → `consumed`

- `accept` can set an exploration to `discarded` at review.
- `intake` turns a `done` exploration into change tasks. The change tasks give its id in `exploration`.
- When each change task of an exploration is `done`, the exploration is `consumed`.

A task or an exploration can have a `milestone`. To see how far a milestone is, count its items by status.

## Rules

- Use the words of `context/glossary.md`. Do not use a different word for the same thing.
- A task gives the number of a decision. Do not copy the text of a decision into a task.
- Keep a fact in its task or exploration. When a future task will get it wrong without the fact, write it under `## Context changes`.
- When the work needs a decision that the task does not give:
  - If the decision changes what the product does for its users or for other systems, or changes stored data, stop and ask.
  - If the decision changes only how the code is written, make the decision and write the reason.

## Context changes

A skill does not change `context/` directly. It writes each change under `## Context changes` of the task or the exploration.

- `accept` writes the changes of a change task to `context/` when the person accepts the task.
- The changes of an exploration do not go to `context/`. `intake` copies them to the change tasks that it makes from the exploration.

Write one item for each change:

- The file: positioning, non-goals, glossary, a rules file, or a new decision.
- The old text, when there is one.
- The new text.
- The reason.

## Skills

| Skill    | It does                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `intake` | Turns any input into change tasks or an exploration, or into one line in the inbox. Turns a done exploration into change tasks. |
| `probe`  | Settles with the person each thing that a change task leaves open                                                               |
| `build`  | Builds one ready change task or exploration. No person watches it.                                                              |
| `accept` | Reviews the work with a person. Promotes the facts of a change task to `context/`.                                              |
