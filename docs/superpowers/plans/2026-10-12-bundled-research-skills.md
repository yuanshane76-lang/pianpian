# 预置研究技能与流式滚动修复计划

**Goal:** 消除研究对话流式输出的滚动争抢，随 Windows 压缩包分发可发现、可读取、可调用的研究流程 Skill。

**Architecture:** 基于已提交的 Pi 功能分支，在独立 worktree 实现。Skill 文件是研究流程的来源，清单只拥有中文显示名和入口问题；Electron 通过名称白名单读取预置 Skill，Pi 不扫描个人技能目录。界面消费会话启动事件中的技能清单，并以独立样式维护滚动和技能入口。

**Tech Stack:** React 18、TypeScript、Electron、Pi SDK 1.1.0、Vitest、Playwright、Electron Forge。

## 文件归属

- `src/features/reader/useConversationScroll.ts`：流式跟随、用户滚动、尺寸变化和动画帧清理。
- `src/features/reader/ResearchAssistant.tsx`、`ResearchAssistant.css`：技能入口和滚动绑定。
- `skills/research/manifest.json`、三个 `SKILL.md`：纸研预置技能与入口信息。
- `electron/research-skills.cjs`：预置技能名称白名单、读取和 Pi 资源适配。
- `electron/pi-agent.cjs`、`research-agent-tools.cjs`、`research-agent-runtime.cjs`：技能发现、受控读取工具及会话清单。
- `src/services/researchAgentProtocol.ts`：技能摘要协议和长度校验。
- `forge.config.cjs`：只打包清单、三个技能文件及运行时模块。
- 对应测试、模拟桌面验收脚本和架构文档由本任务维护，不修改其他工作区。

## 1. 先写回归测试

- [x] React 测试以真实消息增量触发渲染，模拟可滚动区域。确认流式输出跟随底部、用户向上滚动后不被拉回、回到底部后恢复跟随；在一帧内合并多次内容更新。
- [x] 技能测试确认三个标准 `SKILL.md` 能被 Pi 发现，通过名称读取全文，拒绝路径和未知名称。
- [x] 协议与界面测试验证 `session_started.skills` 的结构和长度，点击中文技能入口发送对应问题。
- [x] Forge 测试确认允许发布的技能文件被包含，额外文件、个人技能目录和私有 PDF 被排除。
- [x] 执行聚焦测试，记录修复前的失败。

滚动测试使用如下几何条件，避免把 jsdom 没有布局能力当成产品结果：

```ts
Object.defineProperties(scroller, {
  scrollHeight: { configurable: true, get: () => height },
  clientHeight: { configurable: true, value: 200 },
  scrollTop: {
    configurable: true,
    get: () => top,
    set: (value) => { top = Math.max(0, Math.min(value, height - 200)); },
  },
});
```

## 2. 实现流式跟随

- [x] `useConversationScroll()` 返回滚动区 ref、内容 ref、滚动处理和恢复跟随函数。React 提交后通过一个待执行的动画帧调整 `scrollTop`；用户滚离底部时取消跟随。
- [x] 用 `ResizeObserver` 覆盖窗口、侧栏和内容高度变化。卸载时取消动画帧并断开观察器。
- [x] 覆盖原有平滑滚动，关闭浏览器滚动锚定，并为滚动条预留宽度。用户发送新问题时恢复底部跟随。
- [x] 重跑聚焦测试，确认原有审批、文档和切换论文行为正常。

## 3. 创建预置研究技能

- [x] `paper-deep-reading`：读取问题所需的当前论文原文，解释研究问题、方法、实验和限制，以页码标注证据；原文不足时说明缺口。
- [x] `literature-search-review`：把研究问题转成有限检索式，串行查询公开元数据，去重并说明筛选理由；429 后停止连续重试，元数据不作为已读全文。
- [x] `literature-comparison-notes`：按可得原文、摘要和元数据进行有证据等级的对比，形成中文 Markdown 草稿；未取得的全文和实验细节不补写。
- [x] 每个技能使用标准 `name` 与 `description` frontmatter；清单包含名称、中文显示名和入口问题。
- [x] 通过 `read_research_skill({ name })` 返回预置说明，禁止路径参数和外部目录读取。
- [x] Pi `getSkills()` 使用预置目录的标准加载结果；系统提示词加入名称、描述及受控读取工具用法，不提前塞入全部技能正文。
- [x] 启动事件发送技能摘要，界面以可展开的“预置研究技能”显示入口；不复制技能清单到前端源码。

## 4. 验证分发与真实 SDK 工具循环

- [x] 本地合成 SSE 驱动真实 Pi，先调用 `read_research_skill`，随后调用论文、检索和笔记工具，断言技能说明确实进入模型后续上下文。禁止外部请求。
- [x] 扩展隔离 Electron 验收，用长时间合成流检查底部跟随、用户滚动中断、恢复跟随、窗口尺寸变化和卸载。
- [x] 运行 `npm run check`。
- [x] 运行 Windows ZIP 打包，读取压缩包内 `app.asar` 的技能文件；解压到工作区内验收目录，用隔离用户数据启动压缩包，验证中文壳、预置技能和 Pi 工具循环。
- [x] 更新架构与研究助手技术文档，分别报告单元测试、构建、模拟桌面、打包和真实服务调用；此次不调用真实模型或 MinerU。
