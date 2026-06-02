# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/bry-guy/pi-ez-worktree/compare/v1.0.1...v1.1.0) (2026-06-02)


### Features

* add worktree include config ([75f7b07](https://github.com/bry-guy/pi-ez-worktree/commit/75f7b07ddb515cf4a6f87ce3a8057e926089f97b))
* handle ezwt commands from chat input ([a6a0167](https://github.com/bry-guy/pi-ez-worktree/commit/a6a0167dba66600026ff53b8771ab2c89bbff7af))
* rename slash command to worktree ([9564ef2](https://github.com/bry-guy/pi-ez-worktree/commit/9564ef22a842a8e56167ccd7c78ce56863f244ca))
* support optional and external includes ([91bc3d8](https://github.com/bry-guy/pi-ez-worktree/commit/91bc3d8369dc21e57b7d266510008f1aec0b279e))

## [1.0.1] - 2026-05-23

### Fixed
- Stop overriding core project tools while no worktree is active, so pi-chat's Gondolin-routed tools and other extension delegates remain in control for inactive sessions.

### Added
- Plan for Gondolin-native worktrees and pi-ez-delegate integration in `docs/plans/gondolin-native-worktrees.md`.

## [1.0.0] - 2026-03-05

### Added
- Initial `pi-ez-worktree` release as a shareable pi package.
- Runtime extension that redirects `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, and user `!bash` into an active worktree.
- Slash commands: `/wt-start`, `/wt-attach`, `/wt-status`, `/wt-finish`, and `/wt-abort`.
- LLM tools: `worktree_begin`, `worktree_attach`, `worktree_status`, `worktree_finish`, and `worktree_abort`.
- Companion `git-worktree-flow` skill for natural-language invocation.
- CLI helpers: `pi-wt-create`, `pi-wt-attach`, `pi-wt-status`, `pi-wt-finish`, and `pi-wt-abort`.
- Automatic finish flow with commit-if-needed, rebase in the worktree, fast-forward merge back into the base branch, and optional cleanup.
- Worktree metadata file for reliable later re-attachment.
- `wt-status` attachable-candidate output when no worktree is active.
- `mise` smoke-check task and GitHub-ready package structure.
