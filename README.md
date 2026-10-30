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
5. Adds the hub to Paseo as a project, and creates a schedule that builds the next ready change task. Turn off "Archive on finish" for the schedule in Paseo's Schedules view, so each run stays for review. The CLI cannot set it.

`--dry-run` prints what would change. `--no-schedule` skips Paseo.

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
