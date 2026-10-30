# Factories hub

The factory: four skills, and a template for a product hub.

- `skills/` — `intake`, `probe`, `build` and `accept`. They work the same for each product and each stack.
- `hub-template/` — the files of a product hub. Copy it one time for each product.

The hub is above the code repositories. Run the agents in the hub.

## Start a product

1. Copy `hub-template/` to a new folder, for example `acme-hub`, and make it a git repository.
2. Add each repository to `mars.yaml`: `npx @dean0x/mars add <git url>`. They are cloned into `repos/`.
3. In `CLAUDE.md` of the hub, write the name of the product and the path of each repository (`repos/<name>`).
4. In `CLAUDE.md` of each repository, write how to run its checks.
5. In `factory.json`, give the setup command of each repository under `repos`, for example `"web": { "setup": "npm install" }`. Change the schedule if you need to.
6. Run `node scripts/setup.mjs`. It copies the skills into `.claude/skills/`. Commit the hub and push it.

## Set up a machine

Clone the hub and run the setup script in it:

```sh
git clone <hub url> && cd <hub folder>
node scripts/setup.mjs
```

The script works out the hub's name and path from its folder, and changes only what is missing, so you can run it again at any time. It:

1. Checks the tools in `factory.json`: installed, and signed in where a tool has a login (`gh`, `claude`). It installs nothing. When a tool is missing, it names it and stops.
2. Checks the skills in `.claude/skills/`. They are committed in the hub. A hub that has none yet gets them with `scripts/update-skills.mjs`.
3. Clones the repositories in `mars.yaml` into `repos/`.
4. Runs the `setup` command of each repository.
5. Adds the hub to Paseo as a project.

`--dry-run` prints what would change. `--no-paseo` skips Paseo.

## Run builds on a machine

The worker builds the hubs of a fleet on one machine, for example a Mac mini at home. The fleet is a git repository with one file, `hubs.json`: the git URLs of the hubs.

```json
["git@github.com:you/acme-hub.git"]
```

Install the worker once on the machine:

```sh
git clone git@github.com:thetutlage/factories-hub.git ~/.factory/factories-hub
node ~/.factory/factories-hub/worker/install.mjs --fleet <git url of the fleet>
```

It needs git, Node, `gh`, Claude Code and Paseo signed in on the machine. Paseo's desktop app does not need to run: use its daemon, and reach it from your phone or laptop. launchd runs the worker every 2 minutes (`--every <seconds>`). Each poll:

1. Pulls the fleet. A new hub is cloned into `~/factories/` (`--hubs <folder>`) and set up with `scripts/setup.mjs`. The worker then opens an issue in the fleet repository, `<hub> on <machine>`: the hand-off.
2. Fetches each hub, and fast-forwards its checkout. The worker never edits the checkout. When it has local changes, the worker skips the hub and reports it once.
3. Waits while a change task of the hub is `building`, or a build session runs.
4. Takes the next ready change task, by the rule of the build skill. `build.repos` in `factory.json` limits it to tasks of those repositories.
5. Claims the task: sets it to `building` and pushes the hub, so another machine does not take it.
6. Makes the build folder `.factory/builds/<id>`: a worktree of the hub, and a worktree of each repository of the task on `task/<id>`. It copies the files in `repos.<name>.copy` of `factory.json`, such as `.env`, and runs `repos.<name>.setup`.
7. Starts one Paseo session in the folder with the build skill.

A hub with nothing to build costs a `git fetch` and no session. When a task is `done`, the worker removes its build folder.

The worker reports to the hub's issue in the fleet repository, once for each problem: a failed setup, a checkout with local changes, a build that could not start, and a claimed task whose session ended without a status change. A report comments on the issue and reopens it. Close the issue when the problem is handled. The log is `~/.factory/worker.log`.

`node worker/worker.mjs --dry-run` prints what a poll would do. `node worker/install.mjs --uninstall` removes the launchd job.

## Update the skills

The skills are files in the hub, copied from this repository. Change a skill here, not in a hub, then update each hub:

```sh
node scripts/update-skills.mjs                # the latest commit of skills.ref
node scripts/update-skills.mjs --from <path>  # a local clone of this repository, as it is on disk
```

It writes the commit it copied to `skills.commit` in `factory.json`. Review the diff, then commit it.

## The flow

```
input ─intake─▶ change task (draft) ─probe─▶ ready ─build─▶ review ─accept─▶ done
          ├───▶ exploration (ready) ─build─▶ review ─accept─▶ done ─intake─▶ change tasks
          └───▶ inbox.md
```

When each change task of an exploration is `done`, the exploration is `consumed`.
