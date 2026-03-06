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
- **CLI helpers:** small composable commands for create/attach/status/finish/abort

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
- `/wt-attach [branch-or-path]` — attach this pi session to an existing worktree
- `/wt-status` — show current worktree status
- `/wt-finish [--strategy auto|ff-only|squash|merge] [--no-cleanup] [commit message]` — commit if needed, merge back, and optionally keep the worktree around
- `/wt-abort [--force] [--keep-branch]` — remove the active worktree flow for this session

## Agent tools

The extension also exposes tools so the agent can act on natural language requests:

- `worktree_begin`
- `worktree_attach`
- `worktree_status`
- `worktree_finish`
- `worktree_abort`

## How attach works

`/wt-attach` and `worktree_attach` accept either:

- a branch name, like `pi/fix-login`
- a worktree path, like `../.pi-worktrees/my-repo/fix-login`

If you omit the target, attach succeeds only when there is exactly **one** attachable worktree for the repository. If there are several, the tool tells you which branches/paths are available so you can choose one explicitly.

When `pi-ez-worktree` creates a worktree, it also writes a small `.pi-ez-worktree.json` metadata file inside that worktree. That lets a later pi session re-attach cleanly and recover the original base branch and main checkout.

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
- `pi-wt-status`
- `pi-wt-finish`
- `pi-wt-abort`

`pi-wt-status`, `pi-wt-finish`, and `pi-wt-abort` accept state JSON via `--state-json` or stdin. `pi-wt-attach` discovers an existing worktree and prints state JSON for it.

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

## Local development

This repo includes a tiny `mise.toml` for a smoke check:

```bash
mise run check
```
