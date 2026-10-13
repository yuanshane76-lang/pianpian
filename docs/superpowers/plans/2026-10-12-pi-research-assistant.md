# Pi 研究助手实现计划

> **REQUIRED SUB-SKILL:** Use `superpowers:test-driven-development` for each behavior change and run the focused test before implementation.
> **REQUIRED SUB-SKILL:** Use `superpowers:ui-ux-pro-max` for the research assistant interaction and visual validation.

**目标：** 在纸研工作台中加入基于 Pi 的研究助手，支持当前论文理解、公开文献检索、受控加入文献库和可见的工具执行链。

**方案：** 在 Electron 主进程中使用 Pi SDK 创建受控 Agent 会话，使用内存认证和自定义模型注册，关闭 Pi 内置工具，只注册纸研工具；通过 preload allowlist 把统一的 Agent 事件传到 React；React 以消息时间线和工具卡片呈现对话。没有可用密钥时阻止会话启动并引导配置。

## 任务 1：建立协议和产品文档

**文件：**

- 新增 `docs/PRD-研究助手.md`
- 新增 `docs/技术选型-研究助手.md`
- 新增 `docs/superpowers/plans/2026-10-12-pi-research-assistant.md`
- 新增 `src/services/researchAgentProtocol.ts`
- 新增 `src/services/researchAgentProtocol.test.ts`

**步骤：**

1. 先写事件、消息、工具调用和审批结果的失败测试。
2. 定义严格的 `ResearchAgentEvent`、`ResearchAgentMessage`、`ResearchAgentToolCall` 和 `ResearchAgentApproval` 类型。
3. 实现事件归一化和文本/数组上限校验。
4. 运行协议测试，确认状态转换和非法 payload 会失败。

## 任务 2：接入 Pi 运行时和服务适配

**文件：**

- 修改 `package.json`
- 修改 `package-lock.json`
- 新增 `electron/pi-agent.cjs`
- 新增 `electron/research-agent-runtime.cjs`
- 新增 `tests/electron/researchAgent.test.ts`

**步骤：**

1. 安装固定版本 `@earendil-works/pi-coding-agent@1.1.0`，使用当前 ModelRuntime/InMemoryCredentialStore API。
2. 先为 Pi session adapter 写失败测试：启动、工具事件、流式回答、停止。
3. 实现 Pi runtime 和事件发射。
4. 实现 Pi SDK 适配：内存认证、动态模型注册、只允许纸研自定义工具。
5. 把 Pi 事件转换为前端协议，覆盖模型错误和工具错误。
6. 运行 Electron runtime focused tests。

## 任务 3：加入安全 IPC 边界

**文件：**

- 修改 `electron/main.cjs`
- 修改 `electron/preload.cjs`
- 修改 `src/platform/electron.ts`
- 新增 `src/services/researchAgent.ts`

**步骤：**

1. 为 `start`、`update-context`、`prompt`、`abort`、`approve`、`save-document` 增加 allowlist 通道。
2. 复用现有安全设置读取逻辑，不把密钥放入 renderer payload。
3. 为每个窗口维护运行时句柄，并在窗口销毁时停止会话。
4. 把主进程事件转成 renderer 可订阅的清理函数。
5. 测试未知 channel、错误 sender 和过大 payload。

## 任务 4：实现论文与文献工具

**文件：**

- 新增 `electron/research-agent-tools.cjs`
- 新增 `electron/literature-search.cjs`
- 新增 `src/domain/literature.ts`
- 新增对应测试文件

**步骤：**

1. 先测试 `read_current_paper` 和 `search_library` 的确定性结果。
2. 实现公开学术元数据适配器，使用 fetch 注入和合成响应。
3. 实现检索结果去重与字段长度限制。
4. 实现加入文献库审批请求和批准/拒绝回传。
5. 复用 `src/services/library.ts` 写入，保持稳定论文 ID 和现有数据模型。

## 任务 5：实现研究助手 UI

**文件：**

- 新增 `src/features/reader/ResearchAssistant.tsx`
- 修改 `src/features/reader/ReaderAssistant.tsx`
- 修改 `src/app/App.tsx`
- 修改 `src/app/index.css`

**步骤：**

1. 先写消息时间线和工具卡片的失败渲染测试。
2. 实现研究助手入口、消息列表、工具状态、引用标签和输入区。
3. 实现确认卡片、拒绝、重试和停止。
4. 把当前论文和本地文献元数据注入 Agent。
5. 适配浅色学术风格、窄窗口、长文本和 loading 状态。
6. 运行 UI focused tests。

## 任务 6：整体验收

**文件：**

- 修改或新增测试文件
- 可能修改 `scripts/` 下的桌面验收脚本

**步骤：**

1. 运行协议、工具、Electron 和 React focused tests。
2. 运行 `npm run check`。
3. 使用真实 Pi session 执行多轮问答、搜索、确认加入、拒绝和失败重试；自动化测试使用假的 Pi session 或本地 SSE 模型。
4. 启动桌面端，使用真实 MinerU 和模型完成“读取论文及检索 → 确认入库 → 生成并保存阅读笔记”三轮对话，检查流式消息、工具过程和前端结果并保留截图。
5. 记录真实模型调用、外部网络、打包和其他未执行项目。
