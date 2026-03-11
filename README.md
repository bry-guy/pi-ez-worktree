# pi-ez-worktree

`pi-ez-worktree` is a shareable [pi](https://pi.dev) package that lets a **single current pi session** drop into its own git worktree.

It is intentionally narrow:
- one active worktree per pi session
- no subagents
- no multi-worktree manager
- easy merge-back when the task is done

This is designed for the workflow where you run multiple pi instances against the same repository and want their branches and file edits isolated from each other.

## What it includes

- **Extension:** overrides pi's built-in project tools so the current session transparently operates inside an active worktree
- **Skill:** teaches the agent when to start the worktree flow from natural language
- **CLI helpers:** small composable commands for create/attach/detach/list/status/finish/abort

## Install

```bash
pi install git:github.com/bry-guy/pi-ez-worktree
```

Or try it without installing:

```bash
pi -e git:github.com/bry-guy/pi-ez-worktree
```

If pi is already running, install the package and then run `/reload` in that pi session. Otherwise just start a new pi session after installing.

## Commands

- `/wt-start <name>` — create and attach a fresh worktree for this pi session
- `/wt-attach [branch-or-path]` — attach this pi session to an existing worktree; when omitted in interactive mode, pi prompts you to choose
- `/wt-detach` — detach this pi session from its active worktree without deleting the worktree
- `/wt-list` — list linked worktrees for this repository
- `/wt-status` — show current worktree status, or list attachable worktrees when none is active
- `/wt-finish [--strategy auto|ff-only|squash|merge] [--no-cleanup] [commit message]` — commit if needed, merge back, and optionally keep the worktree around
- `/wt-abort [--force] [--keep-branch]` — remove the active worktree flow for this session

## Agent tools

The extension also exposes tools so the agent can act on natural language requests:

- `worktree_begin`
- `worktree_attach`
- `worktree_detach`
- `worktree_list`
- `worktree_status`
- `worktree_finish`
- `worktree_abort`

## How attach works

`/wt-attach` and `worktree_attach` accept either:

- a branch name, like `pi/fix-login`
- a worktree path, like `../.pi-worktrees/my-repo/fix-login`

If you omit the target, attach behaves like this:

- in interactive pi, it opens a picker when more than one attachable worktree exists
- in non-interactive mode, it succeeds only when there is exactly **one** attachable worktree
- otherwise it tells you which branches/paths are available so you can choose one explicitly

When `pi-ez-worktree` creates a worktree, it also writes a small `.pi-ez-worktree.json` metadata file inside that worktree. That lets a later pi session re-attach cleanly and recover the original base branch and main checkout. The package also adds that file to the worktree's local git exclude list so it does not pollute status or get committed.

## Default finish behavior

`worktree_finish` defaults to `strategy: auto`, which does this:

1. auto-commit dirty worktree changes if needed
2. rebase the worktree branch onto its base branch **inside the active worktree**
3. fast-forward merge the result back into the base branch from the original checkout
4. remove the worktree and delete the task branch

If the rebase conflicts, the conflict stays in the active worktree so the current pi session can resolve it with full context.

## How tool routing works

When a worktree is active, the extension overrides:

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- user `!bash` commands via the `user_bash` hook

Relative project paths and shell commands are redirected into the worktree automatically. Absolute paths outside the repository are left alone.

## CLI helpers

These are also shipped as small composable commands:

- `pi-wt-create <name>`
- `pi-wt-attach [branch-or-path]`
- `pi-wt-detach`
- `pi-wt-list`
- `pi-wt-status`
- `pi-wt-finish`
- `pi-wt-abort`

`pi-wt-status`, `pi-wt-finish`, `pi-wt-abort`, and `pi-wt-detach` accept state JSON via `--state-json` or stdin. `pi-wt-attach` discovers an existing worktree and prints state JSON for it. `pi-wt-list` prints linked worktrees for the current repository.

Example:

```bash
STATE=$(pi-wt-create feature-foo | jq -c '.state')
printf '%s\n' "$STATE" | pi-wt-status
printf '%s\n' "$STATE" | pi-wt-finish --strategy auto
```

## Simple examples

### Start a fresh isolated session

Inside your repo:

```text
/wt-start bugfix-auth
```

Then just keep working normally. `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, and `!bash` all target the worktree automatically.

### See what is available

To list linked worktrees for the repo:

```text
/wt-list
```

If no worktree is active for the current session, this also works:

```text
/wt-status
```

It will list attachable worktrees and suggest `/wt-attach` usage.

### Resume an existing worktree later

If you kept a worktree around with `--no-cleanup`, open a new pi session in the main checkout and run:

```text
/wt-attach pi/bugfix-auth
```

or:

```text
/wt-attach ../.pi-worktrees/my-repo/bugfix-auth
```

If there is only one attachable worktree, this also works:

```text
/wt-attach
```

If there are multiple and you're in interactive pi, omitting the argument opens a picker so you can choose one directly.

### Temporarily leave the active worktree attached state

If you want to stop routing this session into the worktree without deleting the worktree itself:

```text
/wt-detach
```

You can later re-attach with `/wt-attach`.

### Finish and merge back automatically

```text
/wt-finish
```

That defaults to `auto`: commit if needed, rebase in the worktree, fast-forward merge back into the base branch, then clean up.

If you want to keep the worktree around after merging:

```text
/wt-finish --no-cleanup
```

## Notes

- The package expects you to start from a normal named git branch, not detached HEAD.
- The original checkout must remain clean when finishing a worktree.
- The package is optimized for local branch isolation, not remote PR orchestration.
- Current limitation: pi's built-in `@` file picker and path autocomplete still use pi's original process cwd, not the active ez-worktree. The extension can redirect tools and bash execution, but pi does not currently expose a clean API to retarget the editor's autocomplete root.

## Local development

This repo includes a tiny `mise.toml` for a smoke check:

```bash
mise run check
```

## Release process

This repository is set up for squash-merged PRs and automated semver bumps:

- GitHub Actions runs CI on pushes and pull requests.
- PR titles are checked for Conventional Commit style (`feat:`, `fix:`, `docs:`, etc.).
- `release-please` watches `main` and opens a release PR that updates `package.json` and `CHANGELOG.md`.
- Merge that release PR to create the next version tag and GitHub release.

Semver mapping:
- `fix:` => patch
- `feat:` => minor
- `feat!:` or `BREAKING CHANGE:` => major

See [CHANGELOG.md](CHANGELOG.md) for released versions.
