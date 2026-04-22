# Changelog

## [1.0.0] - 2026-04-22

First public release of this fork of [`fredrikalindh/mcp-mochi`](https://github.com/fredrikalindh/mcp-mochi) v2.6.0.

Extends upstream with full Mochi API coverage, faithful response schemas and automatic retry on Mochi's per-account concurrency limiter.

### Added

- Deck CRUD tools: `create_deck`, `get_deck`, `update_deck`, `archive_deck`, `delete_deck`.
- `get_flashcard` tool – fetch a single flashcard by ID.
- `create_template` tool – create new card templates.
- `add_attachment` and `delete_attachment` as standalone tools (previously attachments could only be added inline during card creation).
- `pos` and `reviewReverse` parameters on `create_flashcard` and `update_flashcard`.
- Automatic retry on HTTP 429 from Mochi's per-account concurrency limiter (three attempts, exponential backoff plus jitter).
- Root `LICENSE` file with dual copyright lines crediting both upstream author and fork author.

### Changed

- Response schemas flipped from `.strip()` to `.passthrough()` – all documented Mochi fields now reach callers (`created-at`, `updated-at`, `reviews`, `references`, `parent-id`, `sort-by`, `cards-view`, `show-sides?`, etc.).
- `CardSchema` and `DeckSchema` extended to declare every documented field explicitly.
- `trashed` on card update now accepts an ISO 8601 timestamp (per Mochi docs), a string or a boolean for convenience – boolean `true` is converted to the current timestamp, `false` passes through unchanged.
- `trashed` schemas now enforce ISO 8601 format via `z.string().datetime()`.
- All `.describe()` strings end with a period, following the Google JavaScript / TypeScript style guide convention.
- Package scope renamed from `@fredrika/mcp-mochi` to `@k-and/mcp-mochi`.
- Package description updated to reflect the fork's scope.

### Fixed

- `CardSchema.name` now accepts `null` – Mochi's `GET /cards/:id` response can return `"name": null` for cards without an explicit name.
- `TemplateFieldSchema.name` and `.pos` are now optional, matching the Mochi API documentation.
- `createCardFromTemplate` skips unnamed template fields when building the name-to-ID map.
- Skip retry on 429 for multipart uploads – `form-data` streams are one-shot and cannot be safely replayed.

[1.0.0]: https://github.com/k-and/mcp-mochi/releases/tag/v1.0.0
