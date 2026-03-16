# Proposal: let extensions override the cwd used by pi's file picker/autocomplete

Status: draft only, not filed upstream yet.

## Goal

Prepare a simple issue for the main pi GitHub repo asking for a small extension API that lets an extension retarget the built-in `@` file picker / path autocomplete away from `process.cwd()`.

This is primarily needed by `pi-ez-worktree` (sometimes described as pi-ez-worktrees): once a session is attached to a git worktree, tool calls and bash can be redirected into that worktree, but pi's built-in picker/autocomplete still appears to resolve from the original process cwd.

## Proposed upstream issue

### Title

Allow extensions to override the cwd/root used by the built-in `@` file picker and path autocomplete

### Body

pi currently appears to root the built-in `@` file picker / path autocomplete at `process.cwd()`.

That works for normal sessions, but it blocks extensions that change the session's effective project root at runtime.

A concrete example is `pi-ez-worktree`: it can attach the current pi session to an active git worktree and redirect tool calls + bash into that worktree, but the built-in picker/autocomplete still points at the original checkout. That means the session can be editing one tree while the picker suggests files from another.

Request: please expose a small extension hook or API that allows an extension to provide the effective cwd/root for the built-in picker/autocomplete instead of hard-coding `process.cwd()`.

Ideal behavior:
- default stays exactly as it is today when no extension overrides anything
- an extension can set or return an alternate root dynamically
- the override can change during a live session (for example after `/wt-start`, `/wt-attach`, or `/wt-detach`)
- if possible, use the same override for the eventual `@file` path resolution too, so suggestions and actual resolution stay consistent

This would make `pi-ez-worktree` feel native and would likely help any other extension that remaps the effective project root.

## Why this matters for `pi-ez-worktree`

`pi-ez-worktree` is specifically built around the idea that one pi session can keep working inside an attached git worktree while the original checkout remains untouched.

Today it can already redirect:
- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- user `!bash`

But the built-in picker/autocomplete still follows the original cwd, which creates a mismatch between:
- where the session actually operates, and
- what files the user sees and inserts from the picker.

That mismatch is the last major rough edge in the worktree flow.

## Implementation plan

Keep the upstream request simple, but the likely implementation path is:

1. Add a single extension-facing override for the editor/file-picker cwd.
   - Could be a new hook/event.
   - Or a direct API like `ctx.ui.setAutocompleteBasePath(...)`.
   - The important part is that it can change during the session.

2. Stop hard-wiring the interactive autocomplete provider to `process.cwd()` only.
   - Today interactive mode constructs `CombinedAutocompleteProvider(..., process.cwd(), fdPath)`.
   - Instead, let it read from the override when present.

3. Make the override live-updateable.
   - `pi-ez-worktree` would update it after attach/detach/start/finish/abort.
   - Fallback remains the original process cwd.

4. If feasible, apply the same effective cwd to final `@file` resolution.
   - That keeps the picker suggestions and inserted file resolution aligned.

5. Document the feature with one small extension example.
   - `pi-ez-worktree` is the clearest motivating example.

## Notes / evidence

Relevant places observed while preparing this:

- In this repo, `README.md` already calls out the limitation:
  - pi's built-in `@` file picker and path autocomplete still use pi's original process cwd, not the active ez-worktree.

- In `extensions/git-worktree.js`, tool execution is already redirected using an effective cwd derived from the active worktree.

- In pi's installed code, interactive mode currently initializes autocomplete with `process.cwd()`:
  - `.../pi-coding-agent/dist/modes/interactive/interactive-mode.js`

- In pi-tui, `CombinedAutocompleteProvider` takes a `basePath` that defaults to `process.cwd()`:
  - `.../pi-tui/dist/autocomplete.js`

## Suggested follow-up after filing

If the pi maintainers like the idea, the next step would be a small proof-of-concept patch in pi plus a matching update in `pi-ez-worktree` to set the active worktree as the picker root.
