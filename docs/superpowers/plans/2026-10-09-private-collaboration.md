# Private Collaboration Implementation Plan

> **For agentic workers:** 按任务逐项执行并核对结果。用户已授权直接完成协作配置；共享工作区的其他产品任务保持独立。

**Goal:** 为纸研工作台建立中文协作约定、可复现验证和私有 GitHub 仓库接入流程。

**Architecture:** 协作配置在 `chore/collaboration-setup` 独立工作区实现，基于已有稳定提交。发现旧 PRD 的 Git 历史包含疑似凭据后，用脱敏源码在 `paperquay-share` 建立无旧历史的协作仓库，旧工作区保持离线。GitHub CI 仅验证无密钥的代码；真实服务配置继续由桌面安全存储拥有。

**Tech Stack:** Git worktree、GitHub CLI、GitHub Actions、Node.js 24、npm、Vitest、Electron。

---

### Task 1: 协作规则与入门

**Files:** `AGENTS.md`、`CONTRIBUTING.md`、`README.md`、`.github/ISSUE_TEMPLATE/`、`.github/PULL_REQUEST_TEMPLATE.md`。

- [x] 写明任务分支、独立工作区、文件归属、PR 审查、测试和密钥边界。
- [x] README 使用 `npm ci` 与 `npm run desktop:dev`；说明网页版能力边界。
- [x] 为问题和需求提供中文 Issue 模板，为 PR 提供验证清单。

### Task 2: 自动验证和本地一致性

**Files:** `.github/workflows/quality.yml`、`.nvmrc`、`.editorconfig`、`.gitattributes`、`.gitignore`、`package.json`、`package-lock.json`、`scripts/desktop-e2e.cjs`、`scripts/pdf-layout-e2e.cjs`。

- [x] Windows PR 检查依次运行 `npm ci` 和 `npm run check`，不读取服务密钥。
- [x] 固定 Node.js 24 系列、文本换行和编辑格式；忽略用户数据与测试输出。
- [x] 把桌面 E2E 的 Playwright 导入改为项目依赖，把 Electron 路径改为 `require("electron")`。
- [x] 在干净协作仓库安装锁定依赖并运行完整检查；159 项测试、凭据检查、类型检查和构建通过。真实服务 E2E 未执行。

### Task 3: 私有仓库接入

**Files:** `scripts/setup-github.ps1`、`docs/GitHub私有协作配置.md`。

- [x] 脚本验证登录身份、干净工作区、读取及实际推送地址和私有可见性，并固定质量检查的提交 SHA。
- [x] 空仓库初始化原子地要求远程 main 不存在；已有主分支的仓库上传任务分支并创建 PR。
- [x] 脚本实现 Squash merge 和分支保护配置；套餐不支持时报告真实状态，实际远端结果等待认证完成后验证。
- [x] 脱敏 PRD；建立常见凭据格式及当前分支历史检查，并覆盖历史凭据和错误推送边界。
- [x] 把脱敏稳定版本导出到独立的 `paperquay-share` 仓库，不传输旧历史。
- [x] 检查文件和当前分支历史中的常见凭据格式；新仓库初始历史通过检查，旧历史保留离线。
- [x] 验证本地提交、GitHub 私有可见性和检查状态；稳定基线已上传，远端 Quality 检查成功。

远端已创建并推送。Squash merge 和工作流只读权限已生效；私有仓库分支保护因套餐限制返回 HTTP 403，没有启用。见 `docs/协作配置验收.md`。
