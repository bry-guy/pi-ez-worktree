# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0](https://github.com/bry-guy/pi-ez-worktree/compare/v1.0.0...v2.0.0) (2026-03-19)


### ⚠ BREAKING CHANGES

* replace /wt-* slash commands with /ezwt

### Features

* add detach and list worktree commands ([9a14bb4](https://github.com/bry-guy/pi-ez-worktree/commit/9a14bb4483f32afeb9cd40025962c9f0a6a06389))
* replace /wt-* slash commands with /ezwt ([a7c083d](https://github.com/bry-guy/pi-ez-worktree/commit/a7c083d88e092b93a41de7c86f6722893c0e2735))

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
