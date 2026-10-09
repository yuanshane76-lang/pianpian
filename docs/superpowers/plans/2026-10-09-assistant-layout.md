# Reader Assistant Layout Implementation Plan

**Goal:** Make the research sidebar content-first, readable, and usable without scrolling to reach the question composer.

**Architecture:** Keep the existing assistant props, AI requests, chart component, and cache ownership. Put selected content first, disclose the original/overview/import details progressively, and separate the scrolling results from a persistent question composer. Scope visual tokens and controls to the reader assistant.

**Tech Stack:** React, TypeScript, Lucide, CSS, Vitest, Playwright.

## Interaction And Structure

- [x] Add `tests/app/readerAssistant.test.tsx` covering content order, collapsed original, persistent composer, tab keyboard controls, copy feedback/failure, and busy states.
- [x] Run the focused tests and confirm the new behavior fails before implementation.
- [x] Update `src/features/reader/ReaderAssistant.tsx` without changing its public props or AI/cache routing.

## Visual Design

- [x] Update sidebar typography, neutral surfaces, result headings, action groups, and scrollbars in `src/app/index.css`.
- [x] Keep chart previews and vocabulary usable in the redesigned sidebar.
- [x] Check desktop, narrow desktop, small phone, and short landscape layouts without horizontal overflow.

## Verification

- [x] Run the assistant/reader interaction tests, complete Vitest suite, TypeScript/build, and whitespace checks.
- [x] Capture and inspect browser screenshots for translation, explanation, chart, vocabulary, and busy/empty states.
- [x] Review task-owned changes and preserve all preexisting work. Do not commit or package.

## Review Corrections

- [x] Reveal pending/cached Q&A once per submitted question without repeatedly overriding user scrolling.
- [x] Keep the error-state composer usable in a short landscape viewport with search open.
- [x] Mark the covered PDF and hidden outline inert on narrow screens; focus the assistant tab on opening and restore the toggle on closing.

Skill: applied the installed `ui-ux-pro-max` accessibility, typography, progressive disclosure, and layout guidance. Its `scripts` entry is a broken portable link to an absent `C:/Users/45070/src/ui-ux-pro-max` directory, so its design-system CLI was unavailable. No skill installation was modified.

Final evidence: 35 Vitest files / 185 tests passed; TypeScript and production build passed; `git diff --check` passed. `out/assistant-layout-checks/report.json` records 13 successful desktop checks with zero renderer errors and zero paid AI requests. Tested 1440x920, 1024x768, 375x812, and 812x375, including a short error/search state, clipboard copy, keyboard question submission, original disclosure, vocabulary search, chart image loading, mobile focus restoration, and a fixed composer. AI text in screenshots is deterministic layout-fixture content; live AI correctness was not revalidated. Production build retains the existing large-chunk warning.
