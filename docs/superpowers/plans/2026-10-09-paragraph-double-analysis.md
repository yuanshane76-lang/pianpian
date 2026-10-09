# Paragraph Double Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select a paragraph on click and start full-paragraph translation plus explanation in parallel on double-click.

**Architecture:** Keep single-click selection in the PDF block overlay, add a separate double-click callback that passes the clicked block directly to the app, and extend analysis request bookkeeping so the two operations have independent abort and streaming state. Add an accessible hover/title hint to paragraph hit areas without changing behavior for figures, tables, or text selection.

**Tech Stack:** React 18, TypeScript, Vitest, PDF.js overlay buttons, existing Electron streaming bridge.

---

### Task 1: Lock down paragraph interaction behavior

**Files:**
- Create: `tests/app/paragraphQuickAnalysis.test.tsx`

- [x] Add a PDF text-layer regression test that double-clicking a paragraph passes the full block despite a selected word.
- [x] Add an app interaction regression test that double-clicking a paragraph starts exactly one translation stream and one explanation stream, and both results render.
- [x] Run focused tests and observe the expected failures before implementation.

### Task 2: Add the PDF interaction callback and hint

**Files:**
- Modify: `src/features/reader/BlockList.tsx`
- Modify: `src/features/reader/PdfPreview.tsx`
- Modify: `src/features/reader/PdfPageCanvas.tsx`
- Modify: `src/features/reader/ReaderView.tsx`

- [x] Thread `onAnalyzeParagraph` from `ReaderView` through `PdfPreview` and `PdfPageCanvas` to `BlockList`.
- [x] Keep click selection unchanged and invoke the new callback only for paragraph blocks.
- [x] Add the floating copy `双击，翻译并解释整段` for paragraph blocks with an accessible descriptive label.

### Task 3: Run parallel paragraph analysis safely

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/features/reader/ReaderAssistant.tsx`

- [x] Allow opted-in concurrent analysis requests to keep independent abort controllers while preserving cancellation for normal sequential actions.
- [x] Add independent pending and streaming state for translate and explain.
- [x] Add a full-paragraph handler that clears sentence selection, starts both operations with the clicked block, and reuses the existing translation cache and explanation state.
- [x] Render both operation-specific loading states and streamed text in their respective tabs.

### Task 4: Verify the feature

**Files:**
- Create: `scripts/paragraph-quick-analysis-e2e.cjs`

- [x] Run focused PDF and reader interaction tests (52 passed at the first feature-complete checkpoint).
- [x] Run `npm run build`.
- [x] Run `git -c core.safecrlf=false diff --check`; existing unrelated dirty changes were preserved.
- [x] Verify real desktop PDF text-layer double-click and independent IPC/SSE streams with deterministic responses and no paid requests.
- [x] Verify hint placement and assistant reopening at 1440, 1024, and 375 pixel widths.

### Final Evidence

- Full regression: 37 files, 219 tests passed.
- TypeScript and Vite production build passed; the existing large-chunk warning remains.
- Desktop verification: six checks passed in `out/paragraph-quick-analysis-checks/report.json`, including real PDF text-layer input and independent Electron streams.
- Review fixes: background preview cancellation is isolated from foreground analysis, and repeated-click text selection remains available on headings and equations.
- No paid service requests were made during these checks. No Git commit or package release was created.
