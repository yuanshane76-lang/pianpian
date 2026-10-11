# 参与开发

这是纸研工作台的私有开发仓库。开始之前，请先阅读 [AGENTS.md](AGENTS.md)。

仓库所有者本机的正式路径为 `D:\Desktop\grade4\workspace\zhiyan`。协作者可以克隆到自己的任意目录，源码和验证脚本不得依赖维护者电脑上的绝对路径。

## 首次运行

准备 Git、Node.js 24.x 和随 Node.js 安装的 npm。项目目前以 Windows 桌面端为主要交付目标。

接受维护者的 GitHub 协作邀请后，使用 GitHub 页面上 **Code** 菜单提供的仓库地址：

```powershell
git clone <仓库地址>
cd <仓库目录>
npm ci
npm run desktop:dev
```

开发时只需预览网页，可以运行 `npm run dev`，打开 `http://127.0.0.1:4173/`。网页预览也会将导入的 PDF 保存在浏览器存储中；桌面版将原件保存为用户数据目录中的文件。系统密钥存储和 MinerU 调用需要桌面端。

桌面窗口打开后，在“服务配置”里填写自己的 DeepSeek 或百炼 API Key，以及 MinerU Token。只做界面、领域规则和自动测试时，无需配置密钥。申请步骤见 [服务密钥配置](docs/服务密钥配置.md)。

同一台电脑同时启动多个桌面实例会竞争默认端口；通常只启动一个需要实际交互的实例，其他任务在独立工作区运行测试。

## 日常协作

先在 Issue 中写明任务范围、验收条件和涉及的主要文件。一个分支处理一件事，避免把新功能、无关重构和格式化混在一起。

```powershell
git switch main
git pull --ff-only
git switch -c feat/reading-progress
```

修改后检查差异，只暂存本任务的文件：

```powershell
git status --short
git diff
npm run check
git add <本任务文件>
git diff --cached
git commit -m "feat: 保存论文阅读进度"
git push -u origin feat/reading-progress
```

随后在 GitHub 提交以 `main` 为目标的 PR。维护者审查，通过自动检查后 Squash merge。合入以后再更新本地 `main`。

多人或多个代理同时开发时，使用独立工作区：

```powershell
git fetch origin
git worktree add -b fix/pdf-selection ../zhiyan-pdf-selection origin/main
```

工作区里已有其他任务的修改时，保留现场，不执行清理、覆盖或批量暂存。依赖变动同时提交 `package.json` 和 `package-lock.json`。

## 命令与验证

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run desktop:dev` | 启动桌面开发模式 |
| `npm run dev` | 启动网页开发预览 |
| `npm test -- --run` | 运行自动测试 |
| `npm run check:credentials` | 检查常见凭据格式及当前分支历史，不打印密钥 |
| `npm run check` | 凭据检查、测试、TypeScript 检查和前端构建 |
| `npm run make:win` | 验证后生成 Windows x64 免安装压缩包 |

启动 `npm run dev` 后，可另开终端执行桌面检查：

| 命令 | 数据与服务边界 |
| --- | --- |
| `node scripts/mineru-gate-e2e.cjs` | 隔离文献库、合成 PDF 和模拟 MinerU：验证强制解析门禁、真实阶段进度、下载持久化与重启恢复，不调用真实服务 |
| `node scripts/desktop-e2e.cjs` | 临时空用户目录：验证中文壳、配置和 IPC；无需密钥和论文，禁止外部服务请求 |
| `npm run test:paragraph-vocabulary:e2e` | 合成 PDF、模拟 SSE 与隔离桌面用户目录：验证段落词汇、单词表、Markdown、摘要和图表流式显示、定位提示及多种窗口尺寸；不调用真实模型服务 |
| `node scripts/translation-math-e2e.cjs` | 临时用户目录和固定公式数据，无付费请求 |
| `node scripts/paragraph-quick-analysis-e2e.cjs` | 读取本机已解析论文和配置，隔离浏览器会话、模拟模型响应；不是空文献库检查 |
| `node scripts/reader-chart-e2e.cjs` | 读取本机已解析论文和配置，隔离浏览器会话；默认跳过 AI 操作、禁止外部请求，检查连续翻页、图表和布局 |
| `node scripts/pdf-layout-e2e.cjs` | 需要本机已解析的 Attention 论文；默认禁止外部服务，检查逐页坐标和划选 |

后面三项是维护者的本机验收，不是协作者空文献库下的自动验收。`--live-ai` 明确允许真实付费调用，只有已获准使用的配置、论文和环境才能运行。历史真实服务结果不能替代新版本重新验证。

`node scripts/explanation-e2e.cjs --live-ai` 专门验证真实解释服务并可能计费；缺少该参数时脚本拒绝执行。

真实服务测试使用自己的密钥和获准上传的论文，单独记录结果。PR 自动检查只运行 `npm run check`，不调用真实服务。

## PR 内容

按 PR 模板说明问题、最终行为和验证。界面改动附前后截图；PDF 定位问题说明页码、缩放和侧栏状态；协议或缓存修改说明兼容性。

审查反馈需要落实到代码或给出具体理由。检查没有跑过、服务没有真实调用过时如实说明，不能把模拟测试描述为真实端到端通过。

仓库和分支设置步骤见 [GitHub 私有协作配置](docs/GitHub私有协作配置.md)。
