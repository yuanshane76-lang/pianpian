# ArXiv Paper Import Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Preserve unrelated user changes and do not commit them.

**Goal:** Let the global research assistant find verified arXiv papers, ask before downloading, store the actual PDF in the local library, and report success only after persistence.

**Architecture:** Electron main owns arXiv requests, PDF validation, durable document storage, and serialized import ownership through a finalization receipt. Search results carry session-verified candidate IDs; renderer approval downloads only the verified arXiv ID and upgrades or creates a readable paper record. The existing MinerU queue handles parsing.

**Tech Stack:** Electron IPC, Node fetch streams, `@xmldom/xmldom`, React, Vitest, existing PDF.js and document-store services.

---

### Task 1: Verified literature candidates

**Files:** `electron/literature-search.cjs`, `electron/research-agent-tools.cjs`, `electron/research-agent-runtime.cjs`, `electron/pi-agent.cjs`, `tests/electron/researchAgent.test.ts`

- [x] Test Atom parsing, exact-title ranking, arXiv IDs, and candidate-ID-only selection.
- [x] Query the arXiv Atom API and Crossref independently; preserve usable results if one provider fails.
- [x] Bind bounded candidate IDs to the current runtime and reject unsearched candidate IDs.
- [x] Update the assistant tool schema and instructions to require search before adding and distinguish PDF download from metadata-only records.

### Task 2: Secure PDF download and storage

**Files:** create `electron/arxiv-pdf-download.cjs`; modify `electron/main.cjs`, `electron/preload.cjs`, `forge.config.cjs`; create `tests/electron/arxivPdfDownload.test.ts`

- [x] Test valid PDF persistence, invalid identifiers, redirects, MIME/magic checks, timeouts, and the 100 MB cap with injected fetch responses.
- [x] Download only canonical arXiv PDF URLs, bound response bytes, then persist through the existing document store.
- [x] Expose a secure IPC operation returning only the saved document ID, filename, and duplicate flag.

### Task 3: Durable library upgrade and truthful approval

**Files:** modify `src/services/library.ts`, `src/domain/library.ts`, `src/domain/literature.ts`, `src/services/researchAgentProtocol.ts`, `src/features/reader/ResearchAssistant.tsx`, `src/app/App.tsx`, corresponding tests.

- [x] Test that approval fails when persistence returns no receipt and remains pending while async download completes.
- [x] Let PDF preparation reuse a main-process saved document instead of saving the same bytes again.
- [x] Upgrade a matching reference record while preserving its group and favorite state; persist the readable record before returning `{ persisted: true, id, ... }`.
- [x] On failure, remove only newly downloaded, unreferenced originals; trigger the existing MinerU queue after successful library persistence.
- [x] Label arXiv approval as PDF download and metadata-only approval as metadata addition.
- [x] Serialize import cleanup, retries, and manual original writes in the main process; cancel unfinished imports on unmount or Agent termination.
- [x] Preserve existing PDF identities and user fields; keep different PDF versions separate and reuse upgraded records on manual reimport.

### Task 4: End-to-end regression and documentation

**Files:** research-agent E2E fixture, `docs/架构说明.md`, `README.md` or applicable user documentation.

- [x] Add a deterministic synthetic arXiv-search → approval → PDF-persistence → library-visible E2E.
- [x] Run focused tests, `npm run check`, and the research-agent E2E when the local desktop environment permits.
- [x] Document source coverage and clearly distinguish automatic arXiv PDF import from metadata-only Crossref results.

## Validation

Use synthetic Atom XML and a small synthetic PDF; do not call paid services, upload user papers, or modify the user's existing library. Run each focused test red before implementation, then green. Finish with `git diff --check`, `npm run check`, the relevant E2E, and an explicit status for any unavailable verification.

### Verified outcome

- `npm run check`: 64 files / 517 tests passed, credential audit, TypeScript and production build passed.
- `node scripts/research-agent-e2e.cjs`: isolated Electron / real Pi SDK with synthetic search, PDF, model and MinerU responses passed; zero external calls.
- Public network probe: exact-title arXiv search found `1706.03762v7`; the actual downloader received and validated all 2,215,244 PDF bytes in memory without changing the user library. No paid services were used.
- Windows ZIP built with the cached Electron runtime verified against the installed release SHA-256. Extracted `Pianpian.exe` passed `packaged-research-skills-e2e.cjs`; archive checks confirmed the arXiv/import modules, XML parser and IPC endpoints.
- Independent review findings on cancellation races, lifecycle cancellation, version handling and stable identity were fixed and re-reviewed.
- Real model/MinerU execution of the import flow remains unverified; desktop coverage uses synthetic services.
