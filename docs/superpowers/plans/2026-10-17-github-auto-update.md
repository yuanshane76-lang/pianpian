# GitHub 自动更新实施计划

**目标：** 使用 GitHub Releases 分发 Windows 安装包；桌面端手动检查、下载并在用户确认后更新，保存原有论文、索引、分组、词汇、历史与密钥。

**架构：** Electron 主进程独占网络、验签、更新状态与本机备份；React 仅显示状态和发送固定 IPC。采用 electron-updater + electron-builder NSIS，保留原 ZIP。固定旧 userData、正式页面 origin 和存储键；发布元数据使用独立 Ed25519 发布密钥签名，公钥随应用分发，私钥在仓库外或 CI Secrets 保存。GitHub 源码仓库不自动公开，公开发行仓库独立配置。

**边界：** 不修改另一工作区的三份未提交阅读器修改；不带入废弃夜间形象；不调用真实模型/MinerU，不推送或合入 main；本地测试不冒充 GitHub 线上跨版本验收。

## 任务

- [x] 新分支从 origin/main 开始；依赖锁定 electron-updater 6.8.9 / electron-builder 26.15.3。
- [x] 先补更新状态机与签名协议测试，确认缺少模块失败；实现固定 GitHub 源、版本/哈希签名验证、重复调用合并、下载失败重试、禁止静默安装与降级。
- [x] 先补备份测试，确认失败；实现关键 localStorage 导出、加密配置/对话/解析元数据备份，拒绝符号链接、失败禁止安装；PDF 原件仍在原目录，不重复复制大量原件。
- [x] 主进程添加安全 IPC 和菜单入口；更新前阻止新写入，活动模型/导入/解析任务期间不安装，历史落盘和 session 刷盘后备份再调用安装器。
- [x] React 添加全局更新弹窗，文献库底部入口与菜单共用；可访问性、错误重试、进度、更新说明、稍后安装和数据保留说明有组件测试。
- [x] 配置 NSIS 安装包、稳定 appId/GUID、用户级安装、卸载不删除数据，版本升为 0.4.0；旧 Forge ZIP 仍可构建。
- [x] 增加发布脚本：读取仓库外签名私钥、签名 manifest、上传 GitHub Release，包含 EXE、latest.yml、blockmap、ZIP 和 SHA256；检查公开发行仓库，禁止将凭据带入应用。
- [x] 添加 Windows CI 构建/发布流程、README、架构/升级操作说明。
- [x] npm run check 全量通过；打包真实 NSIS/ZIP；隔离 Electron 视觉验收和本地更新源失败/成功验收；数据保留测试；独立代码审查并修复重要问题。

## 验收用例

1. 无新版本、网络失败、非法签名、旧版本、hash 不符分别产生真实中文状态，不能执行安装。
2. 有新版本后点击下载，进度可见；下载后不自动退出，稍后按钮保持应用可用。
3. 写入/生成中的应用拒绝安装；备份/flush 失败保留已下载状态，禁止退出安装。
4. 两个隔离版本共享同一个旧式数据目录，升级后论文文件、词汇、分组、阅读位置、对话、加密配置保持可读。
5. 正式源不可达时旧版仍可用；开发/旧 ZIP 不伪装成已安装自动更新版。

## 验证记录

本地验收：`npm run check` 通过（65 个测试文件，511 项测试）；`npm run update:e2e` 通过；`npm run make:win` 通过。产物为 Windows NSIS 安装包与 ZIP，并使用仓库外 Ed25519 私钥生成更新签名。Windows Authenticode 未签名。真实安装/升级未执行。GitHub 发布仓库 `yuanshane76-lang/pianpian-releases` 当前不存在，故真实 GitHub 检查/下载/发布以及 Actions CI 尚未验证；没有创建或公开仓库。
