---
name: git-worktree-flow
description: Use when the user wants this current pi session to do work in its own git worktree, especially to run multiple pi instances in the same repository without branch interference.
---

# Git Worktree Flow

Use the `worktree_*` tools from the pi-ez-worktree package instead of manually juggling `git worktree` commands.

## When to use this
- The user says to do the task in a fresh worktree
- The user wants this current pi session isolated from other pi sessions in the same repo
- The user wants to resume an existing worktree from a new pi session
- The user wants merge-back handled automatically at the end

## Rules
1. Do **not** spawn subagents or additional pi instances.
2. Manage **at most one** active worktree for this session.
3. If a worktree is already active, continue using it instead of creating another one.
4. Prefer `worktree_finish` with strategy `auto` unless the user explicitly asks for squash or merge-commit behavior.
5. If finish reports a conflict, stay in the same session and resolve it there.

## Workflow
1. Call `worktree_status` to see whether a worktree is already active.
2. If none is active and the user wants to resume an existing worktree, call `worktree_attach` with a branch or path when the user provides one. If the user does not provide one, `worktree_attach` only succeeds when there is exactly one attachable worktree.
3. Otherwise call `worktree_begin` with a short task name.
4. Do the requested coding work normally. The extension redirects project file tools and bash commands into the active worktree automatically.
5. When the user asks to wrap up, call `worktree_finish`.

## Notes
- `/wt-start`, `/wt-attach`, `/wt-status`, `/wt-finish`, and `/wt-abort` are user-facing slash commands.
- The extension handles the actual tool routing; do not try to manually keep track of alternate directories in your own reasoning.
