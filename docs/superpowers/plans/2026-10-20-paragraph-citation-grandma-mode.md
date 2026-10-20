# 段落引用与祖母模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让用户把选中的论文段落加入当前论文对话输入框，并可在段落理解区域开启“祖母模式”，让段落翻译、解释、摘要和词汇结果使用极通俗的中文。

**Architecture:** 保持 `App` 拥有分析请求和缓存身份，`ReaderAssistant` 只呈现段落操作和开关，`ResearchAssistant` 拥有对话输入状态。选中段落通过 `ReaderView` 的回调传入对话组件；引用以带论文、页码和段落 ID 的纯文本引用块插入输入框，不自动发送。祖母模式作为 `AiRequest` 的显式 `readingMode` 传入主进程，并加入段落缓存身份。

**Tech Stack:** React 18、TypeScript、Electron IPC、Vitest、现有 CSS token 与 Lucide 图标。

---

### Task 1: 固定引用格式和缓存模式契约

**Files:**
- Modify: `src/domain/analysis.ts`
- Modify: `src/services/ai.ts`
- Modify: `tests/domain/analysisCache.test.ts`
- Modify: `tests/electron/ai.test.ts`

- [x] **Step 1: Write failing tests**
  - 断言 `buildParagraphCacheIdentity` 在 `standard` 与 `grandma` 下生成不同 key。
  - 断言 AI 请求类型接受 `readingMode: "grandma"`。
  - 断言主进程生成的提示词包含“极通俗”和“像给不熟悉专业术语的人讲解”。

- [x] **Step 2: Run focused tests and verify failure**
  - Run: `npm test -- --run tests/domain/analysisCache.test.ts tests/electron/ai.test.ts`
  - Expected: 新增断言因函数参数和请求字段不存在而失败。

- [x] **Step 3: Implement minimal contract**
  - 为 `AiRequest` 增加 `readingMode?: "standard" | "grandma"`。
  - 为 `buildParagraphCacheIdentity` 增加可选模式参数，默认 `standard`，并把模式写入 `sourceSignature`。
  - 在 Electron AI 提示词中只对段落操作追加祖母模式要求。

- [x] **Step 4: Run focused tests**
  - Run: `npm test -- --run tests/domain/analysisCache.test.ts tests/electron/ai.test.ts`

### Task 2: 接通祖母模式到段落请求

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/features/reader/ReaderView.tsx`
- Modify: `src/features/reader/ReaderAssistant.tsx`
- Modify: `tests/app/readerInteraction.test.tsx`
- Modify: `tests/app/paragraphQuickAnalysis.test.tsx`

- [x] **Step 1: Write failing UI/request tests**
  - 断言段落理解区域出现 `祖母模式` switch，默认关闭。
  - 打开后触发翻译、解释和摘要请求时，stream payload 带 `readingMode: "grandma"`。
  - 祖母模式下生成的缓存不复用标准模式结果；关闭后可以回到标准模式缓存。

- [x] **Step 2: Run focused tests and verify failure**
  - Run: `npm test -- --run tests/app/readerInteraction.test.tsx tests/app/paragraphQuickAnalysis.test.tsx`

- [x] **Step 3: Implement minimal wiring**
  - 在 `App` 保存 `readingMode`，将其传入 `ReaderView` 和段落处理函数。
  - 所有段落分析的 `buildParagraphCacheIdentity` 和 `requestAnalysis` 使用当前模式。
  - 在 `ReaderAssistant` 的段落标题区域加入可访问的 `role="switch"` checkbox，明确提示“只影响后续生成”。

- [x] **Step 4: Run focused tests**
  - Run: `npm test -- --run tests/app/readerInteraction.test.tsx tests/app/paragraphQuickAnalysis.test.tsx`

### Task 3: 实现选中段落加入论文对话

**Files:**
- Create: `src/domain/researchCitation.ts`
- Modify: `src/features/reader/ReaderAssistant.tsx`
- Modify: `src/features/reader/ReaderView.tsx`
- Modify: `src/features/reader/ResearchAssistant.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/features/reader/ResearchAssistant.css`
- Modify: `src/app/index.css`
- Modify: `tests/app/researchAssistant.test.tsx`
- Modify: `tests/app/readerInteraction.test.tsx`

- [x] **Step 1: Write failing tests**
  - 断言选中句子/段落时显示“加入对话”按钮。
  - 点击后切换到“聊聊”页，并把引用块插入对话 textarea，不自动发送。
  - 引用包含原文、论文标题、页码；重复点击不会覆盖用户已经输入的内容。
  - 断言引用文本作为纯文本显示，不解析其中的 Markdown/HTML。

- [x] **Step 2: Run focused tests and verify failure**
  - Run: `npm test -- --run tests/app/researchAssistant.test.tsx tests/app/readerInteraction.test.tsx`

- [x] **Step 3: Implement minimal citation flow**
  - `src/domain/researchCitation.ts` 提供纯函数 `formatResearchCitation`，限制引用原文长度并输出稳定格式。
  - `ReaderAssistant` 接收 `onAddToConversation`，在选中句子或段落上下文提供入口。
  - `ReaderView` 负责把入口动作转为 `ResearchAssistant` 的草稿追加。
  - `ResearchAssistant` 接收一次性 `draftAppend` 事件，追加到当前草稿并聚焦 textarea。

- [x] **Step 4: Run focused tests**
  - Run: `npm test -- --run tests/app/researchAssistant.test.tsx tests/app/readerInteraction.test.tsx`

### Task 4: 完成样式、回归和文档

**Files:**
- Modify: `src/app/index.css`
- Modify: `src/features/reader/ResearchAssistant.css`
- Modify: `docs/架构说明.md`
- Modify: `docs/英文论文辅助阅读设计.md`

- [x] **Step 1: Add accessible responsive styles**
  - 让 switch、引用按钮保持现有 teal token、焦点轮廓和最小点击区域。
  - 让窄屏下引用按钮和祖母模式说明不挤压段落 tabs。

- [x] **Step 2: Run focused and full validation**
  - Run: `npm test -- --run tests/domain/analysisCache.test.ts tests/electron/ai.test.ts tests/app/readerInteraction.test.tsx tests/app/paragraphQuickAnalysis.test.tsx tests/app/researchAssistant.test.tsx`
  - Run: `npm run build`
  - Run: `git diff --check`

- [x] **Step 3: Report validation boundaries**
  - 明确区分单元测试、组件测试、构建和真实模型调用；真实模型/桌面交互未执行时标记为未验证。
