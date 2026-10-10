# 段落词汇与个人单词表实施计划

**目标：** 当前段落专属词汇、用户主动收藏的跨论文单词表、解释 Markdown 渲染，以及摘要与作用的流式呈现。

**边界：** 保留原始 PDF 阅读面。领域层拥有词汇匹配、收藏身份及结构化预览；服务层负责本地持久化；界面层只呈现状态；主进程负责模型提示和关闭思考模式。收藏不触发模型请求。

## 实施与验收

- [x] 在 `tests/app/paragraphQuickAnalysis.test.tsx` 补充段落隔离、流式摘要、Markdown、主动收藏和重载恢复回归测试，先运行确认失败。
- [x] `src/domain/learning.ts` 使用成熟的部分 JSON 解析器呈现尚未完成的摘要；最终结果仍严格校验后才能缓存。
- [x] `src/features/reader/MarkdownContent.tsx` 使用 React Markdown 和 GFM 安全渲染；禁止原始 HTML、远程图片及不可信链接。
- [x] 在 `electron/ai.cjs` 增加段落词汇操作，只提供当前段落，关闭思考模式；同步服务协议、缓存操作和相关测试。
- [x] `src/app/App.tsx` 按完整段落内容签名和模型配置缓存词汇，切段取消请求，不接受晚到结果。
- [x] `src/domain/wordbook.ts` 拥有收藏去重、来源和掌握状态；`src/services/wordbook.ts` 负责校验后的本地读写，并显式反馈失败。
- [x] 在阅读页和文献库右上角增加单词表入口，提供搜索、掌握状态过滤、移除及原文定位，保留已删除论文的收藏。
- [x] 更新架构文档；运行最终 `npm run check` 及 `npm run test:paragraph-vocabulary:e2e`，验证隔离桌面交互、逐步输出、收藏持久化与多种窗口尺寸。

## 不在本次范围

不修改 PDF 坐标规则、不改后台解析任务、不发布、不提交或推送，也不调用真实付费服务。其他任务对 `tests/domain/pipeline.test.ts` 的修改保留。
