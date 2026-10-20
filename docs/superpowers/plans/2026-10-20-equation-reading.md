# Equation Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make MinerU-recognized equation blocks follow the chart-reading workflow, with a dedicated `equation` AI operation and a Chinese “解读公式” assistant surface.

**Architecture:** Keep equation recognition and coordinates in the existing `DocumentBlock` contract. Add a dedicated structured equation-reading protocol and cache entry, route equation double-clicks through the same PDF-to-App chain as charts, and render the result in a small `EquationContext` component without sending an image.

**Tech Stack:** React 18, TypeScript, Vitest, Electron CommonJS AI transport, KaTeX-backed formula rendering.

---

### Task 1: Define the equation protocol with failing tests

**Files:**
- Modify: `tests/domain/learning.test.ts`
- Modify: `tests/electron/ai.test.ts`
- Modify: `tests/domain/readingFlow.test.ts`

- [x] **Step 1: Write failing parser, transport, and routing tests**

Add tests for:
- strict and partial parsing of `{summary, variables, role, caveats}`;
- an `equation` request using the formula text and nearby paragraph context;
- an equation block being unavailable to paragraph translation.

- [x] **Step 2: Run the focused tests and verify they fail for the missing equation contract**

Run:

```powershell
npm test -- --run tests/domain/learning.test.ts tests/electron/ai.test.ts tests/domain/readingFlow.test.ts
```

Expected: FAIL because the equation parser and operation are not implemented yet.

### Task 2: Add the equation AI operation and structured domain parser

**Files:**
- Modify: `src/services/ai.ts`
- Modify: `src/domain/analysis.ts`
- Modify: `src/domain/learning.ts`
- Modify: `electron/ai.cjs`
- Modify: `src/domain/readingFlow.ts`

- [x] **Step 1: Implement the minimal equation type and parser**

Add `EquationReading`, `parseEquationReading`, and `previewEquationReading` with bounded strings and non-empty validated lists, matching the existing chart parser behavior.

- [x] **Step 2: Add `equation` to the shared operation unions**

Extend the renderer request and cache operation types without changing existing operation names.

- [x] **Step 3: Add the Electron prompt and request validation**

Accept equation blocks for the `equation` operation, reject equation blocks from paragraph translation with a Chinese instruction to use “解读公式”, include equation in selection/structured/non-thinking routing, and send the formula plus adjacent text as text-only model content.

- [x] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
npm test -- --run tests/domain/learning.test.ts tests/electron/ai.test.ts tests/domain/readingFlow.test.ts
```

Expected: PASS.

### Task 3: Route equation blocks through the PDF interaction chain

**Files:**
- Modify: `src/features/reader/BlockList.tsx`
- Modify: `src/features/reader/PdfPageCanvas.tsx`
- Modify: `src/features/reader/PdfPreview.tsx`
- Modify: `src/features/reader/ReaderView.tsx`
- Modify: `src/app/App.tsx`

- [x] **Step 1: Add a failing equation double-click integration test**

Use the existing synthetic PDF reader mount to double-click an `equation` block and assert that the generated request has `operation: "equation"` and the equation block as its target.

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm test -- --run tests/app/readerInteraction.test.tsx -t "equation"
```

Expected: FAIL because equation blocks are not currently analyzable.

- [x] **Step 3: Add the equation callback through the PDF stack**

Keep chart callbacks unchanged and add `onAnalyzeEquation` beside them. The overlay hint should say “双击解读公式”. App state should mirror chart request identity, cancellation, validation, streaming, strict parsing, cache reuse, and failure handling, but skip image loading.

- [x] **Step 4: Run the equation integration test**

Run:

```powershell
npm test -- --run tests/app/readerInteraction.test.tsx -t "equation"
```

Expected: PASS.

### Task 4: Render the dedicated equation assistant surface

**Files:**
- Create: `src/features/reader/EquationContext.tsx`
- Modify: `src/features/reader/ReaderAssistant.tsx`
- Modify: `src/features/reader/ReaderView.tsx`
- Modify: `src/app/index.css`
- Modify: `tests/app/readerAssistant.test.tsx`

- [x] **Step 1: Write a failing assistant rendering test**

Assert that selecting an equation shows “解读公式”, renders streamed structured fields in one result surface, and changes to “公式理解” rather than “图表理解”.

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm test -- --run tests/app/readerAssistant.test.tsx -t "formula|equation"
```

Expected: FAIL because the assistant currently treats only image/table blocks as visual content.

- [x] **Step 3: Add the equation context component and wire props**

Render the original LaTeX with the existing safe formula renderer, expose the “解读公式” action, show streaming and completed structured fields, and keep loading/error/cache behavior owned by App.

- [x] **Step 4: Run the focused assistant tests**

Run:

```powershell
npm test -- --run tests/app/readerAssistant.test.tsx tests/app/readerInteraction.test.tsx tests/app/paragraphQuickAnalysis.test.tsx
```

Expected: PASS.

### Task 5: Verify the combined feature and repository gates

**Files:**
- Modify: `docs/架构说明.md`
- Modify: `docs/自动解析与按需理解交互方案.md`

- [x] **Step 1: Document the equation route**

Mention equation double-click, text-only formula interpretation, structured caching, and the independent “解读公式” action alongside chart reading.

- [x] **Step 2: Run focused tests and type/build checks**

Run:

```powershell
npm test -- --run tests/domain/learning.test.ts tests/domain/readingFlow.test.ts tests/electron/ai.test.ts tests/app/readerAssistant.test.tsx tests/app/readerInteraction.test.tsx tests/app/paragraphQuickAnalysis.test.tsx
npm run build
git diff --check
```

Expected: all focused tests pass, TypeScript/Vite build passes, and `git diff --check` is clean.

- [x] **Step 3: Run the repository check if the focused suite is clean**

Run:

```powershell
npm run check
```

Report separately if the full gate is blocked by unrelated dirty-worktree failures or environment-only checks.
