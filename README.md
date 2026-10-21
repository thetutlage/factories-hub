# Factories hub

The factory: four skills, and a template for a product hub.

- `skills/` — `intake`, `probe`, `build` and `accept`. They work the same for each product and each stack.
- `hub-template/` — the files of a product hub. Copy it one time for each product.

The hub is above the code repositories. Run the agents in the hub.

## Start a product

1. Copy `hub-template/` to a new folder, for example `acme-hub`.
2. In `CLAUDE.md` of the hub, write the name of the product and the path of each repository.
3. In `CLAUDE.md` of each repository, write how to run its checks.
4. Link the skills into the hub:

   ```sh
   mkdir -p .claude/skills
   ln -s <path to factories-hub>/skills/{intake,probe,build,accept} .claude/skills/
   ```

5. Give agents access to the repositories. In `.claude/settings.json` of the hub, add the path of each repository to `permissions.additionalDirectories`.

## The flow

```
input ─intake─▶ change task (draft) ─probe─▶ ready ─build─▶ review ─accept─▶ done
          ├───▶ exploration (ready) ─build─▶ review ─accept─▶ done ─intake─▶ change tasks
          └───▶ inbox.md
```

When each change task of an exploration is `done`, the exploration is `consumed`.
