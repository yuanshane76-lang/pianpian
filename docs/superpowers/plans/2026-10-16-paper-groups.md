# 论文分组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文献库中的旧标签概念替换为可创建、可选择且每篇论文只归属一个分组的工作流。

**Architecture:** `src/domain/library.ts` 持有分组和论文归属的纯规则；`src/services/library.ts` 持有分组持久化及旧论文数据迁移；`App` 统一维护分组状态并把分组筛选、创建和论文编辑传给文献库组件。旧存储只在读取边界识别一次，读取后保存为 `groupId`，界面和后续业务不再使用旧标签字段。

**Tech Stack:** React 18, TypeScript, Vitest, localStorage, lucide-react。

---

### Task 1: 定义分组领域模型并覆盖迁移规则

**Files:**
- Modify: `src/domain/library.ts`
- Modify: `src/services/library.ts`
- Test: `tests/domain/library.test.ts`
- Test: `tests/services/library.test.ts`

- [ ] **Step 1: Write the failing tests**

覆盖以下行为：论文使用单个 `groupId`，空分组名会被拒绝，旧 `tags` 数据读取后迁移到第一个分组，没有旧归属的论文进入“待整理”，保存后的论文不再写入旧字段，分组创建会去除重复空白。

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --run tests/domain/library.test.ts tests/services/library.test.ts`

Expected: FAIL because the current model only exposes `tags` and没有分组持久化。

- [ ] **Step 3: Implement the minimal domain and storage migration**

新增 `LibraryGroup`、默认分组、`groupId` 归属、分组名称规范化，以及 `loadGroups`、`saveGroups`。`loadPapers` 在读取边界将旧 `tags` 转为 `groupId`，新写入只保存 `groupId`。

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run tests/domain/library.test.ts tests/services/library.test.ts`

Expected: PASS。

### Task 2: 接入应用状态、创建分组和论文分组选择

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/features/library/LibraryView.tsx`
- Modify: `src/features/library/LibrarySidebar.tsx`
- Modify: `src/features/library/PaperEditDialog.tsx`
- Modify: `src/features/library/PaperList.tsx`
- Create: `src/features/library/GroupCreateDialog.tsx`
- Test: `tests/app/libraryCrud.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

验证侧栏显示分组、点击分组筛选论文、创建分组后立即显示、编辑论文可以选择现有分组和新建分组、保存后论文归属与本地存储同步。

- [ ] **Step 2: Run the focused interaction test**

Run: `npm test -- --run tests/app/libraryCrud.test.tsx`

Expected: FAIL because the current UI still renders the标签入口 and metadata input.

- [ ] **Step 3: Implement the UI flow**

将侧栏改为分组列表并提供创建按钮；新建分组使用独立弹窗；编辑论文使用单选下拉框并支持在弹窗内新建分组；应用层负责保存分组并将论文 `groupId` 写回论文库。

- [ ] **Step 4: Run focused interaction tests**

Run: `npm test -- --run tests/app/libraryCrud.test.tsx`

Expected: PASS。

### Task 3: 清理业务语言、样式和全部回归夹具

**Files:**
- Modify: `src/app/index.css`
- Modify: `src/domain/literature.ts`
- Modify: all affected tests under `tests/`
- Modify: `docs/架构说明.md`
- Modify: `docs/导入与阅读交互方案.md`

- [ ] **Step 1: Replace library-facing terminology and CSS selectors**

将文献库中的标签文案、类名、搜索提示、详情路径和辅助说明统一替换为分组；保留通用 HTML `label` 和引用协议中的 `label` 字段，不把它们误改为业务分组。

- [ ] **Step 2: Update paper fixtures and literature records**

所有论文测试夹具改用 `groupId`，导入 PDF 和检索收藏记录默认进入“待整理”。

- [ ] **Step 3: Run the full check**

Run: `npm run check`

Expected: 通过凭据检查、全部测试、TypeScript 检查和前端构建。

- [ ] **Step 4: Run the desktop-facing library regression**

Run: `npm run test:library-viewport:e2e`

Expected: 桌面文献库在不同窗口尺寸下仍能看到分组入口、服务配置和主题入口，列表与详情滚动不回归。

### Task 4: Review and commit

**Files:**
- Review: all changes from Tasks 1-3

- [ ] **Step 1: Inspect the diff and search for leaked library terminology**

Run: `rg -n "标签|tags|tag:" src electron tests docs --glob '!docs/screenshots/**' --glob '!docs/assets/**'`

Expected: 只剩兼容迁移字段及与分组无关的通用 `label`/引用协议字段，并在代码中有清晰注释或测试说明。

- [ ] **Step 2: Commit the focused change**

Run: `git add <task-owned-files>; git diff --cached --check; git commit -m "feat: 将论文标签改为分组"`

Expected: 工作区干净，提交只包含本任务文件。
