# Continuous PDF Canvas Implementation Plan

**Goal:** Stack original PDF pages into one continuous scroll surface with adjacent pages visible together.

**Architecture:** Preserve PDF.js and MinerU page-local coordinates. Reserve fixed geometry for every page, rasterize only pages near the viewport, and separate explicit navigation requests from visible-page notifications. Preserve selected blocks while scrolling and restore the reading anchor when zoom or available width changes.

**Tech Stack:** React, TypeScript, PDF.js, Vitest, Electron, Playwright.

- [x] Replace obsolete page-boundary gesture tests with continuous-layout, native-scroll, page-sync and multi-page hit-testing tests; confirm failures.
- [x] Add deterministic page layout, visible-page and render-range calculations with focused domain tests.
- [x] Extract a page-local renderer with independent canvas/text/overlay state and cancellation.
- [x] Update `PdfPreview.tsx` to stack fixed page slots, virtualize nearby rasterization, preserve scroll anchors and navigate without replacing pages.
- [x] Separate explicit page/outline navigation from viewport page updates in `ReaderView.tsx`, retaining newer responsive assistant changes.
- [x] Update real desktop E2E to assert adjacent nonblank page canvases occupy the same viewport and native wheel scrolling does not jump.
- [x] Run focused tests, full suite (37 files / 219 tests), TypeScript/build, diff checks, independent scoped review and desktop screenshots.
- [x] Preserve all unrelated dirty changes. No commit, packaging or credential output.

Desktop evidence: `out/reader-chart-checks/report.json` passed. A single viewport displays 265.61px of page 2 and 288.94px of page 3; wheel delta 160 advances the scroll position by exactly 160. Clicking the previous page's paragraph keeps the seam position unchanged. Shrinking at page 19 preserves the reading fraction (0.344883 to 0.344855). Table/figure selection and 1440/1024 widths pass with zero renderer errors or horizontal overflow.

Regression evidence covers page-20 lazy rasterization, page-20 outline focus after deferred rendering, block-position persistence before rendering, old-document delayed loading, page-gap zoom and current-page notifications without scroll reset. Independent re-review withdrew unsupported lifecycle/focus findings and confirmed concrete gap/position fixes. Preserve parallel assistant, math-rendering and paragraph-double-click work.

Final validation: 37 test files / 219 tests passed; TypeScript and production build passed. Earlier in-progress math/paragraph test failures are cleared in the current combined worktree. Build retains the existing large-bundle warning. The running development desktop remains responsive.
