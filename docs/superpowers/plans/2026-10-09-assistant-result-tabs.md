# Assistant Result Tabs Implementation Plan

**Goal:** Remove the duplicated original-language block and show translation, paragraph summary/role, and explanation as mutually exclusive tab panels.

**Architecture:** Preserve the existing result props and parent-owned AI/cache state. Use a local result-tab selection, with on-demand generation for missing results and icon actions for regeneration. Keep the vocabulary view, chart view, and persistent question composer intact.

**Tech Stack:** React, TypeScript, Lucide, CSS, Vitest, Playwright.

- [x] Add failing cases for removed original content, exclusive result panels, keyboard navigation, cached result reuse, and busy-state request guards.
- [x] Update `ReaderAssistant.tsx` and scoped CSS without changing AI/cache contracts.
- [x] Update reader integration checks and layout E2E for the revised controls.
- [x] Verify 38 focused assistant/reader/AI tests and 15 layout checks across desktop/mobile; preserve user work and do not restart the user's desktop application.
- [ ] Confirm full tests and build after the concurrent PDF continuous-scroll implementation settles.

Related fix: `electron/ai.cjs` now disables thinking for `explain`. Real A/B verification on a 1606-character RAG paragraph reproduced `length` with 4495 reasoning characters and zero final content using the old request, then returned `stop` with 4108 final characters and zero reasoning using the fixed request. Reports are in `out/explanation-before-checks` and `out/explanation-checks`. The user stopped Computer Use before restart, so the existing desktop main process has not reloaded that change.

Validation boundaries: full test run observed 182 passing tests, 8 failures in the concurrently replaced `tests/app/pdfLayout.test.tsx`, and a missing `src/domain/pdfScroll` import in its newly added suite. The subsequent build hit missing `PdfPreview.tsx` while another task was replacing that module. No concurrent PDF files were restored or reverted. The last completed assistant layout report passed with no renderer errors, no horizontal overflow, and no paid model calls. Screenshots use deterministic fixture text next to a real local PDF.

Later concurrent work also added six math-rendering cases to the shared `readerAssistant.test.tsx`. They failed before that feature's implementation; all 13 tab/layout cases still passed on a name-filtered rerun. These unrelated cases were not removed or modified.

Focused review found a keyboard-focus drop when generation replaces the action button. Added a failing regression, then transfer focus to the stable active result tab before generation. Final tab/layout-only rerun: 14 passed, 6 unrelated formula cases skipped explicitly. No generated result or clipboard/cache ownership changed.
