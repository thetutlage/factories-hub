---
name: release
description: Release — recommend which packages to release, with the bump and the order; write the title and the notes of a release that the person published; and move on the tasks that waited for it. Use when a person asks what to release, when a merge leaves work to release, or when the person says that they published a release.
---

# Release

The factory never releases a package. The person starts each release. This skill recommends the releases, writes the notes of a release after the person publishes it, and moves on the work that waited for it.

**Product hub.** Run in the product hub. The hub has `CLAUDE.md`, `context/`, `tasks/` and `explorations/` at its root. If they are missing, say that this is not a product hub, and stop. Read `CLAUDE.md` of the hub, and the files in `context/rules/` about releases.

**State machine.** `.claude/state-machine.md` gives each status, who changes it, and what to do at each change of status. Follow it.

## 1. Recommend the releases

1. Run `node scripts/releases.mjs`. When the request names repositories, give their names to the script.
2. For each commit marked `deps`, read its change of `package.json`: `gh api repos/<owner>/<repo>/commits/<sha>`. It needs a patch only when it changes `dependencies` or `peerDependencies`. A change of the lockfile alone, or of a dev dependency, needs no release.
3. For each package, find the tasks of the hub behind its commits: the tasks whose `pull_requests` or `source` give the pull request of a commit. Read their `## Deployment requirements`.
4. The script gives `after` for each package that depends on another package with work to release. The order matters only when the change needs the new version of that package. Read the range in its `package.json`. Otherwise, say that the order does not matter.
5. Show the person one list, in the order to release:
   - the package, its bump, and the reason: the user-facing changes, with their pull requests;
   - the tasks that wait for the release, for example a docs change to merge after it.

Leave out a package with only changes that need no release. Do not release anything.

## 2. Write the notes

When the person says that they published a release, or names a release:

1. Read the release: `gh release view <tag> -R <owner>/<repo>`. Read the commits since the previous release: `gh api repos/<owner>/<repo>/compare/<previous tag>...<tag>`. For each commit, read its pull request: `gh api repos/<owner>/<repo>/commits/<sha>/pulls`.
2. Read the three releases before it, and follow their style: the title, the headings and the links.
3. Write the title: one line in plain words that names the main change. Not "Release <version>".
4. Write the notes:
   - Keep the heading with the version, the compare link and the date.
   - One item for each change that a user of the package sees: what changes for them, then the link of the pull request, or of the commit when it has none, and the issue that it closes.
   - Leave out the changes that a user does not see: chores, tests, CI, and updates of GitHub Actions or of the lockfile.
   - Give a breaking change its own heading, with what to change in the app.
   - End with the link of the full changelog.
5. Show the title and the notes to the person. When the person says yes, write the notes to a file, and update the release: `gh release edit <tag> -R <owner>/<repo> --title '<title>' --notes-file <file>`.

## 3. Move on what waited

After a release:

- For each task whose `## Deployment requirements` say to merge after this release, its pull requests can merge now. Merge them as `context/rules/merging.md` gives, when the hub has it. Otherwise tell the person.
- For each task that waits on the release in its `## Questions`, for example a bump of the package in another repository, write that the release is out, with its version and date. Tell the person which tasks can go on.
- Commit the tasks that you changed, and push the hub as the state machine gives.

## Hand back

- The releases that you recommend, in order, or `Nothing to release`.
- Each release whose notes you wrote, with its URL.
- Each task that you moved on, and what is left for the person.
