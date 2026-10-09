# Reader Scroll And Chart Reading Implementation Plan

**Goal:** Enable scrolling across PDF pages, route visual blocks to chart reading, and disable thinking for translation.

**Architecture:** Keep the existing single-page PDF.js renderer and coordinate overlays. Route tables/images separately from translation; send a bounded local image with caption and nearby text to the existing secure streaming AI bridge. Cache validated chart results using document, visual-content, and service identities.

**Tech Stack:** Electron, React, TypeScript, PDF.js, Vitest, Playwright.

## Translation Transport

- [x] Add regression cases in `tests/electron/ai.test.ts` for disabled translation thinking, reasoning-only responses, image requests, and truncated results.
- [x] Run focused tests and confirm the missing behavior fails.
- [x] Update `electron/ai.cjs`: provider-specific non-thinking parameters, visual request validation, bounded context, final-output handling.
- [x] Preserve cross-realm error messages in `src/app/App.tsx`; verify via `tests/app/readerInteraction.test.tsx`.

## Cross-Page Scrolling

- [x] Add wheel, reverse arrival, touch, bounds, and inertia cases to `tests/app/pdfLayout.test.tsx`.
- [x] Confirm the new tests fail before changing `src/features/reader/PdfPreview.tsx`.
- [x] Handle vertical wheel and touch gestures only at page boundaries; retain normal within-page scrolling and zoom gestures.
- [x] Restore top on forward navigation and bottom on backward navigation after destination rendering.

## Chart Reading

- [x] Add routing tests in `tests/domain/readingFlow.test.ts` and UI cases in `tests/app/readerInteraction.test.tsx`.
- [x] Add validated chart output parsing in `src/domain/learning.ts` and visual-source signatures in `src/domain/documentBlocks.ts`, reusing their established helpers.
- [x] Add asset-first image loading with bounded PDF crop fallback in `src/services/chartImage.ts`; test rendering and cleanup.
- [x] Extend existing AI/cache operation types with `chart`.
- [x] Connect selection, cancellation, cache, and retry behavior in `src/app/App.tsx`.
- [x] Add original-image preview and distinct chart result sections to the existing assistant without changing the surrounding reader layout.

## Verification

- [x] Rerun focused tests, the entire Vitest suite (34 files / 174 tests), TypeScript, production build, and `git diff --check` after the final malformed-frame and overlapping-action hardening.
- [x] Review task-owned changes independently; leave preexisting PDF worker and packaging edits untouched. Fix seven reproduced boundary findings.
- [x] Exercise wheel/touch navigation and image/table selection in the real Electron app; capture screenshots at 1440 and 1024 widths.
- [x] Verify a real translation request uses non-thinking mode and a real chart request includes the local image without printing credentials.
- [x] Keep desktop test session separate from the user's browser storage. Cache reuse and reload recovery pass; physical touch hardware remains untested. No commit or package created.

Evidence: `out/reader-chart-checks/report.json` records the successful real DeepSeek translation and image-based table interpretation, explicit disabled thinking, 40,923 image-data characters, restored local cache, zero renderer errors and zero horizontal overflow. The default high-concurrency test run hit one existing 5-second document-task timeout; the bounded-worker rerun passed. Production build retains the existing bundle-size warning.
