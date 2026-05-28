# Changelog

All notable changes to sitJac/codex-keeper will be documented in this file.

## [Unreleased]

### Added

- Local-first Codex session scanner for `~/.codex/sessions/**/rollout-*.jsonl`.
- Workspace-grouped Web UI for browsing sessions and reading filtered transcripts.
- Manual session rename with writeback to `session_index.jsonl`, rollout `thread_name_updated` events, and Codex `state_*.sqlite`.
- Session delete support with rollout, index, and local state cleanup.
- CLI and local HTTP API for listing, showing, renaming, deleting, and compacting session index records.
- Regression tests for title source priority, Codex CLI sync, internal session filtering, API behavior, and transcript rendering.
