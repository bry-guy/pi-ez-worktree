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
- **CLI helpers:** small composable commands for create/status/finish/abort

## Install

```bash
pi install git:github.com/bry-guy/pi-ez-worktree
```

Or try it without installing:

```bash
pi -e git:github.com/bry-guy/pi-ez-worktree
```

## Commands

- `/wt-start <name>` — create and attach a fresh worktree for this pi session
- `/wt-status` — show current worktree status
- `/wt-finish [--strategy auto|ff-only|squash|merge] [--no-cleanup] [commit message]` — commit if needed, merge back, and optionally keep the worktree around
- `/wt-abort [--force] [--keep-branch]` — remove the active worktree flow for this session

## Agent tools

The extension also exposes tools so the agent can act on natural language requests:

- `worktree_begin`
- `worktree_status`
- `worktree_finish`
- `worktree_abort`

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
- `pi-wt-status`
- `pi-wt-finish`
- `pi-wt-abort`

`pi-wt-status`, `pi-wt-finish`, and `pi-wt-abort` accept state JSON via `--state-json` or stdin.

Example:

```bash
STATE=$(pi-wt-create feature-foo | jq -c '.state')
printf '%s\n' "$STATE" | pi-wt-status
printf '%s\n' "$STATE" | pi-wt-finish --strategy auto
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
