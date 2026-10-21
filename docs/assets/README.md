# 截图与视觉资产

这些素材服务于仓库介绍，不会给应用添加默认论文、用户数据或演示密钥。README 中的产品界面截图于 **2026-10-21** 从隔离的本地 Electron 环境更新；除明确注明外，文献与模型内容均为合成示例和模拟响应。

| 文件 | 内容与来源 |
| --- | --- |
| `hero.svg` | 本仓库编写的静态矢量封面，使用书本、论文与理解面板示意图；不是应用截图。 |
| `workflow.svg` | 本仓库编写的静态流程图：保存原件 → MinerU 解析与持久化 → 原文阅读 → 用户主动请求 AI。 |
| `library.png` | 当前篇篇文献库的首次启动空状态；使用隔离 Electron 用户目录，不含默认或真实论文。 |
| `reader.png` | 当前 PDF.js 阅读器、段落选区和学术词汇面板；论文与模型响应为合成测试数据。 |
| `wordbook.png` | 当前个人单词表界面；词条为合成示例，来源明确标示为 `Documentation Example`，原文不可用。 |
| `../screenshots/pianpian-workspace.png` | 2026-10-21 重新生成的浅色全库工作区与三个预置研究流程；与仓库中原图像素一致。使用本地合成桌面验收。 |
| `../screenshots/human-mode.png` | 2026-10-21 阅读器中的「人话模式」已开启；使用合成论文，截图只展示模式开关。 |
| `../screenshots/markdown-math-rendering.png` | 2026-10-21 阅读辅助中的 Markdown 层级、列表与数学公式排版；解释文本和公式来自固定测试样例。 |
| `../screenshots/pianpian-reader-light.png` | 2026-10-21 浅色阅读器中的 Pi 对话、工具状态和可点击原文引用；合成 PDF 与本地模拟 SSE 响应。 |
| `../screenshots/research-reader-dark.png` | 2026-10-21 深色阅读器中的 Pi 对话、工具状态和引用；合成 PDF 与本地模拟 SSE 响应。 |
| `../screenshots/research-bundled-skills.png` | 2026-10-12 历史打包验收图，保留作开发记录，不用于当前界面预览。 |
| `../screenshots/research-block-citations.png` | 2026-10-14 历史引用验收图，保留作开发记录，不用于当前界面预览。 |

## 合成数据与验证边界

2026-10-21 更新的阅读器和研究助手截图来自隔离的临时 Electron 用户目录。PDF 与文献元数据在本机合成，解析结果为固定结构化数据，翻译、解释、公式和词汇等响应由本地测试桩提供；桌面验收脚本使用 Pi SDK 和本地模拟 SSE。截图过程中未读取用户文献库、未使用真实密钥、未调用真实模型、MinerU、arXiv、Crossref 或 Semantic Scholar 服务。

`library.png` 特意展示真实的首次启动空状态；`wordbook.png` 的合成词条明确标注示例论文来源，且不提供原文跳转。此类图片用于说明界面布局和交互，不证明真实解析精度、检索可达性、论文下载成功率或模型回答质量。真实服务需由用户自行配置，可能受到网络、服务政策、额度或费用影响。

## 篇篇品牌素材

README 顶部与当前应用使用 `public/brand/` 下的篇篇形象。素材于 2026-10-16 通过 imagegen Python CLI / gpt-image-2 生成，再本地提取透明背景；它们不是桌面截图或论文服务验收结果。详细来源与提示词见 [品牌语言](../品牌语言.md)。
