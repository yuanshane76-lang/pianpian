# Translation Math Rendering Implementation Plan

> **For agentic workers:** Execute the scoped tasks below in order, retaining the existing dirty worktree.

**Goal:** Render preserved LaTeX in the translation panel instead of exposing formula source as plain text.

**Architecture:** A translation-only React component owns an isolated text subtree and uses KaTeX's `renderToString` for formula typesetting. A small escape-aware delimiter scanner separates literal text and formulas, so malformed braces cannot consume subsequent formulas. Only KaTeX-generated HTML enters the DOM; existing request, cache, and clipboard behavior remains unchanged.

**Tech Stack:** React 18, TypeScript, KaTeX, Vitest/jsdom, Playwright/Electron.

---

### Task 1: Reproduce In Panel Tests

**Files:** `tests/app/readerAssistant.test.tsx`

- [x] Add the screenshot's inline generator formula and assert `.katex` and MathML are present.
- [x] Cover `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` with superscripts, subscripts, and fractions.
- [x] Cover incremental updates, malformed formula fallback, switching paragraphs, literal HTML, and copying the original formula source.
- [x] Run `npm test -- --run tests/app/readerAssistant.test.tsx`; confirmed six math assertions fail because the panel currently renders plain text; 13 existing tests passed.

### Task 2: Integrate A Translation-Only Renderer

**Files:** `package.json`, `package-lock.json`, `src/features/reader/TranslationContent.tsx`, `src/features/reader/ReaderAssistant.tsx`, `src/app/index.css`

- [x] Install `katex`; the installed package includes its own TypeScript declarations, so no separate type dependency is needed.
- [x] Add an isolated component using a ref and layout effect: build a fragment of literal text and KaTeX formula wrappers, then replace only the component's children.
- [x] Configure the four delimiters with double-dollar before single-dollar; disable trusted commands and bound macro expansion and sizes.
- [x] Keep unclosed expressions and parse failures as literal source rather than showing errors or dropping text.
- [x] Import the bundled KaTeX CSS/fonts and replace only the translation paragraph.
- [x] Keep original translation strings in clipboard/cache, retain the current 14px body text, and constrain long formulas to local horizontal scrolling.
- [x] Rerun focused tests, then `npm run check` and `git diff --check`; 25 panel tests and 217 tests across 37 files passed, with TypeScript and production build passing.

### Task 3: Verify The Visible Panel

**Files:** `scripts/translation-math-e2e.cjs`; generated evidence under ignored `out/translation-math-checks/`

- [x] Mount deterministic translations in the real desktop shell without calling paid APIs or modifying analysis caches.
- [x] Check inline and display formulas, font loading, repeated streaming updates, literal HTML, and screenshot capture at desktop and narrow/mobile widths.
- [x] Assert no page/sidebar overflow and no renderer exceptions.
- [x] Inspect screenshots and report any unverified live translation behavior explicitly; eight desktop/mobile states passed, including real horizontal scrolling and glyph bounds for a tall inline fraction. No paid translation requests were made.

**Boundary:** This does not repair formulas already corrupted by PDF extraction or the translation model. No parser timing, prompt, cache identity, or backend orchestration changes are included.

**Review findings addressed:** Auto-render's escaped-opening-delimiter and unmatched-brace behavior required using the official KaTeX core API directly. Renderer exceptions are contained per formula. The trust callback always denies access and records the denial to retain every source argument. Four additional regression cases were observed failing before the boundary fixes; the actual streamingOutput completion case also passes.

**Evidence:** `out/translation-math-checks/report.json` and its eight screenshots. Vite reports a non-blocking large-chunk warning. The development server already running at `http://127.0.0.1:4173/` was reused; the packaged Windows distribution was not rebuilt.
