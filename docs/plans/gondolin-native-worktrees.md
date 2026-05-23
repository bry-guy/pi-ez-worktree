# Plan: Gondolin-native worktrees

## Goal

Make `pi-ez-worktree` operate naturally inside pi-chat/Gondolin sessions instead of assuming host-local repository access.

Today `pi-ez-worktree` creates host-side git worktrees and overrides project tools to point at those host paths. That is useful for local TUI pi sessions, but it conflicts with pi-chat's Gondolin tool delegation: an inactive worktree extension must not replace pi-chat's `/workspace` tools, and an active worktree flow should eventually be able to create/use isolated checkouts inside the VM itself.

The target model:

- Local pi TUI sessions can keep using host git worktrees.
- pi-chat/Gondolin sessions can create temporary workspaces inside the VM.
- `pi-ez-delegate` can request Gondolin-native ephemeral worktrees for delegated workers.
- Ephemeral worktrees disappear when the Gondolin instance/storage is destroyed, unless explicitly exported or finished.

## Current behavior and problem

`pi-ez-worktree` currently overrides `read`, `write`, `edit`, `grep`, `find`, `ls`, and `bash` with host-local tools. Even when no worktree is active, those overrides route to `ctx.cwd` on the host.

In pi-chat this breaks the expected route:

```text
Discord message -> pi-chat worker -> delegated tool -> Gondolin /workspace
```

and replaces it with:

```text
Discord message -> pi worker -> pi-ez-worktree host wrapper -> host cwd
```

The immediate fix is to register those project-tool overrides lazily only after this session has an active worktree. That avoids stealing pi-chat's delegated tools in inactive sessions.

## Desired modes

### 1. Host mode

The existing behavior:

- create `git worktree` on the host
- route project tools to the host worktree path
- finish by committing/rebasing/merging on the host

This remains the default for normal local pi sessions.

### 2. Gondolin copy mode

For pi-chat and other sandboxed sessions:

- detect that project tools are already delegated to a sandbox, or let the user opt in with `/ezwt start --mode gondolin`
- copy the current `/workspace` tree to an ephemeral directory inside the VM, e.g. `/tmp/pi-ez-worktrees/<name>`
- route tools to that in-VM path
- finish by producing a patch/bundle/artifact that can be applied back to `/workspace` or the host checkout
- cleanup is automatic when the VM dies

Pros:

- simple and independent of host git metadata
- disposable by construction
- works even when `/workspace` is not a full git repository

Cons:

- merge-back requires patch/apply logic
- large repos cost copy time and disk

### 3. Gondolin git-worktree mode

When `/workspace` is a full git checkout and supports linked worktrees:

- run `git worktree add` inside Gondolin
- keep the linked worktree under an ephemeral in-VM path
- route tools to that path
- finish by committing/rebasing/merging inside the VM, then apply or sync results back to the mounted `/workspace`

Pros:

- closest to existing semantics
- preserves branch-level workflow

Cons:

- `/workspace` may be mounted from host storage; linked worktree metadata may leak into the mounted repo
- depends on git being installed in the VM
- cleanup needs care if the VM dies mid-flow

## Recommended first implementation

Start with **Gondolin copy mode** because it gives the ephemeral semantics we want for pi-chat and `pi-ez-delegate`.

1. Add a worktree backend abstraction:

   ```ts
   interface WorktreeBackend {
     mode: "host" | "gondolin-copy" | "gondolin-git-worktree";
     create(ctx, name): Promise<WorktreeState>;
     attach(ctx, target): Promise<WorktreeState>;
     status(state): Promise<Status>;
     finish(state, options): Promise<FinishResult>;
     abort(state, options): Promise<AbortResult>;
     createToolOperations?(state): ToolOperations;
   }
   ```

2. Keep the current implementation as `host` backend.
3. Add `gondolin-copy` backend that shells out through the current active tool operations rather than Node host `child_process`.
4. Add explicit mode selection:

   ```text
   /ezwt start <name> --mode host|gondolin-copy|auto
   ```

   `auto` should prefer Gondolin when it detects pi-chat/sandbox context.

5. Store backend mode in the session state entry.
6. Route tools only when the active backend says it owns routing.
7. In `finish`, generate a patch from the in-VM copy and apply it to `/workspace` or attach it for the user if automatic apply fails.
8. In `abort`, delete the in-VM copy if the VM is alive; otherwise treat VM teardown as cleanup.

## pi-ez-delegate integration

`pi-ez-delegate` should be able to request an ephemeral Gondolin workspace per delegated worker:

```text
/delegate --workspace gondolin-copy "do task"
```

Expected flow:

1. delegate worker starts in a pi-chat/Gondolin-capable context
2. worker invokes `worktree_begin` with `mode: "gondolin-copy"`
3. work happens inside the VM copy
4. finish returns a patch/result artifact to the parent
5. worker/VM teardown deletes scratch state

This gives cheap isolation without long-lived host worktrees.

## Open questions

- How should the extension reliably detect "tool calls are delegated to Gondolin" without relying on pi-chat internals?
- Should finish auto-apply patches to `/workspace`, or always return an artifact for review?
- Do we need a manifest file in the in-VM copy for recovery while the VM is alive?
- Should `gondolin-copy` require a git repo, or support plain directory diffs too?
- How should secrets and ignored files be handled during copy?

## Non-goals for first pass

- Replacing host-mode worktrees.
- Long-lived Gondolin worktrees across VM restarts.
- Full upstream pi-chat remote command registry.

## Immediate compatibility rule

Until Gondolin-native mode exists, `pi-ez-worktree` must not override core project tools unless this session has an active worktree. Inactive sessions should leave whatever tool routing another extension installed (for example pi-chat's Gondolin delegates) untouched.
