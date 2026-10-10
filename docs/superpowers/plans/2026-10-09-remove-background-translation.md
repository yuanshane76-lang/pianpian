# 移除后台预译实施计划

**目标：** 导入、正文整理、MinerU 完成和重启恢复均不自动调用模型翻译；只保留用户主动触发的段落、划选句子和其他 AI 分析。

**边界：** 沿用当前已附加的词汇功能 worktree，保留单词表与 Markdown 修改，不改正式工作区中另一项阅读进度任务。不删除用户文献、原件、解析资产或历史缓存，不调用真实服务。

## 执行

- [x] 在 `tests/app/paragraphQuickAnalysis.test.tsx` 补充无自动请求、导入、正文整理重试、MinerU 完成和恢复测试，先确认界面和调用回归失败。
- [x] 从 `src/app/App.tsx` 删除预译入口、队列、后台取消控制器、订阅与状态；保留手动翻译、并行解释、取消和缓存。
- [x] 从 `src/domain/pipeline.ts` 删除预译阶段与字段，只保留原件和解析状态。
- [x] 从 `ReaderView.tsx`、`ReaderAssistant.tsx`、`PdfPreview.tsx` 和 `PipelineStatusBar.tsx` 删除预译面板及已失去用途的属性；保留 MinerU 重试。
- [x] 删除无调用者的 `translationQueue.ts` 及其专用测试，清理样式、测试夹具和桌面脚本。
- [x] 同步架构和交互文档，验证 `npm run check` 以及隔离合成数据桌面 E2E，检查窗口截图和零后台模型请求。
