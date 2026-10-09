# Zhiyan Workspace Consolidation Implementation Plan

> **For agentic workers:** 使用独立任务分支执行迁移与验证；只读代码审查作为合入前检查。用户已明确授权最终开发目录为 `D:\Desktop\grade4\workspace\zhiyan`。

**Goal:** 整合最新产品迭代和干净 Git 历史，最终只保留一个正式开发目录。

**Architecture:** 将已连接私有 GitHub 的干净仓库移到用户指定路径；从旧开发工作区按文件迁入最新源码和测试，保留协作检查、密钥隔离和 PR 流程。旧工作区的 Git 历史和忽略文件只保留在工作区外的本地备份，不能进入远端。

**Tech Stack:** Git、GitHub CLI、Electron、React、TypeScript、PDF.js、KaTeX、Playwright、Vitest、PowerShell 7。

---

### Task 1: 固定现场和正式路径

**Files:** `D:\Desktop\grade4\workspace\zhiyan`、本机工作区外备份。

- [x] 核对旧工作区、干净仓库和目标路径；产品开发任务已空闲。
- [x] 已验证 PR #1 质量检查和独立审查，Squash 合入主分支，再同步干净仓库。
- [x] 将干净仓库移动到用户指定路径，建立 `chore/consolidate-zhiyan-workspace` 分支。
- [x] 记录原工作区待迁入文件清单和内容 SHA-256；保留原 Git 历史及忽略文件的离线快照。

### Task 2: 迁入最新功能

**Files:** `src/`、`electron/ai.cjs`、`forge.config.cjs`、`scripts/`、`tests/`、产品实施文档、`package.json`、`package-lock.json`。

- [x] 逐项迁入连续 PDF 阅读、图表理解、段落双击并行分析、助手布局和翻译公式渲染；不覆盖 `AGENTS.md` 或协作脚本。
- [x] 合并 KaTeX、PDF worker 准备命令与既有 Playwright、凭据检查；重建锁文件。
- [x] 桌面 E2E 使用项目依赖，不再访问特定电脑上的 Playwright 路径。
- [x] 添加脚本依赖可移植性验证，先观察失败，再修正路径。
- [x] 更新 README、贡献指南和架构文档，正式路径统一为 `D:\Desktop\grade4\workspace\zhiyan`。

### Task 3: 运行与交付验证

**Files:** `out/` 本地验证输出、`docs/工作区迁移验收.md`。

- [x] 运行 `npm run check`，包括凭据及当前分支历史、测试、类型检查和构建。
- [x] 从正式目录启动桌面开发模式，验证中文壳、PDF worker、连续页面、段落和图表交互。
- [x] 运行无付费请求的桌面公式与段落分析检查；明确真实服务和打包验证边界。
- [x] 独立审查迁移差异，修复阻塞项；本机桌面验收已完成。
- 交付检查点：通过任务分支、PR 和远端检查合入；最终合入状态以 GitHub PR 记录为准。

### Task 4: 移走旧目录

**Files:** 旧 Git worktree 元数据、旧工作区目录、正式 `AGENTS.md`。

- [x] 先把临时 worktree 正规移到备份位置，再移动旧主工作区并修复 worktree 指针。
- [x] 备份根目录在 `workspace` 外，源与目标绝对路径逐项校验，禁止覆盖和递归删除。
- [x] 确认旧目录不再位于 `papers`，正式目录只有一套源码与远程配置；其他论文和原始 PRD 保留。
- [x] 记录唯一启动路径和备份位置，验证原文件归档 SHA-256 与 worktree 指针。
- 交付检查点：PR 合入后切回 `main`，同步远端并确认工作区干净。
