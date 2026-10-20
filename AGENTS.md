# AGENTS.md · AI 代理开发指令（飞扬阅读器）

## 一、项目概述
Electron 桌面电子书阅读器，支持 TXT / EPUB 导入、目录切章、三主题、阅读统计。当前版本 v1.1（自 v1.0 MVP 迭代而来）。

- 主进程：`main.js`（窗口 / 文件对话框 / 磁盘读取 / 编码检测）
- 预加载：`preload.js`（contextBridge 暴露 `openBook` / `readByPath` / `loadSample`）
- 渲染层：`renderer/app.js`（解析 / 目录 / 进度 / 统计）、`renderer/index.html`、`renderer/style.css`
- 数据：localStorage（`er_books` 书架 / `er_prog_<id>` 进度 / `er_theme` `er_font` 设置 / `er_stats` 统计）

## 二、开发规范

1. **零框架渲染层**：不引入 React/Vue；只允许 vendored 的 `jszip.min.js`
2. **安全红线**：
   - 保持 `contextIsolation: true`、`nodeIntegration: false`
   - 渲染层与文件系统的一切交互必须经 `preload.js` 白名单 API
   - EPUB 内容只允许 `textContent` 纯文本渲染，禁止 innerHTML 注入原始 HTML
3. **职责边界**：
   - 编码检测、磁盘 IO 只在主进程做
   - 解析（分章/EPUB）、UI、存储只在渲染层做
4. **存储纪律**：书籍正文永不写 localStorage，按路径重读；所有 localStorage 读写必须 try/catch

## 三、代码风格
- 注释与 UI 文案用中文；函数名小驼峰
- CSS 颜色一律走 CSS 变量，新增主题只需加一组 `body[data-theme="x"]` 变量
- 提交信息格式：`feat: v1.x —— 摘要` / `fix: 摘要`

## 四、测试要求（每次修改后必须人工回归）
1. 导入 GBK 编码 TXT → 中文正常
2. 导入 EPUB → 目录出现 → 点击切章
3. 阅读中途关应用 → 重开恢复位置；返回书架进度刷新
4. 三主题切换 + 重启保持
5. 第一章按 ← / 最后一章按 → 有提示不崩溃
6. 损坏文件导入有 toast 报错，不白屏

## 五、迭代记录约定
每次版本迭代必须：
1. 更新 PRD.md（新增功能表 + 验收标准）
2. 更新 CHANGELOG.md
3. `package.json` version 同步递增
4. UI 左上角版本号徽标同步

## 六、注意事项
1. 打包用 `npm run pack`（electron-packager），产物在 `dist/`，不要把 dist 提交进 git
2. 不要给窗口开 DevTools 默认开启；调试用 `--debug` 参数扩展
3. 主进程 `dialog.showOpenDialog` 必须传 win 句柄保证对话框模态到主窗口
