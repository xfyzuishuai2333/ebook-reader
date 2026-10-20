# 飞扬阅读器 · TECH_DESIGN（技术设计文档）

> 版本：v1.1 ｜ 日期：2026-10-20 ｜ 作者：许飞扬

## 一、技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Electron 44** | 生态成熟、Windows 打包简单；相比 Tauri 免去 Rust 工具链安装，实训环境下落地最快、最稳 |
| 界面 | 原生 HTML5 + CSS3 + JavaScript | 阅读器本质是文本展示，无需框架；CSS 变量天然支持多主题 |
| EPUB 解析 | JSZip 3.10（本地 vendor 引入） | EPUB 本质是 ZIP 包，JSZip 在浏览器端即可解压，无需额外 Node 依赖 |
| 数据存储 | localStorage | 书架元数据、进度、设置、统计都是小体积结构化数据 |
| 打包 | electron-packager | 直接输出免安装目录，朋友解压双击即用 |

### 为什么 v1.0 先做 TXT？
MVP 阶段需要优先验证三件事：① Electron 文件读取链路（主进程 fs → IPC → 渲染层）通不通；② 中文编码检测方案可不可靠；③ 进度存储的 key 设计是否合理。这三点与文件格式无关，先用 TXT 把骨架跑通，v1.1 叠加 EPUB 时零返工。

## 二、项目结构

```
ebook-reader/
├── main.js              # Electron 主进程：窗口、文件对话框、磁盘读取、编码检测
├── preload.js           # contextBridge 安全桥：暴露 openBook/readByPath/loadSample
├── package.json
├── renderer/
│   ├── index.html       # 双视图（书架/阅读）+ 目录侧栏
│   ├── style.css        # CSS 变量三主题（light/sepia/dark）
│   ├── app.js           # 全部渲染层逻辑：解析、目录、进度、统计
│   └── lib/jszip.min.js # EPUB 解压库（vendor 本地化，无 CDN 依赖）
├── assets/sample.txt    # 内置示例书《星海拾光》
├── PRD.md / TECH_DESIGN.md / AGENTS.md / CHANGELOG.md
```

## 三、核心设计

### 3.1 进程模型与安全
```
渲染层 app.js ──ipcRenderer.invoke──> 主进程 main.js ──fs──> 磁盘
     ▲                                     │
     └────── contextBridge(preload.js) ────┘   仅暴露 3 个受控方法
```
- `contextIsolation: true` + `nodeIntegration: false`：渲染层无法直接碰 Node/文件系统
- CSP 限制 `script-src 'self'`，杜绝注入
- EPUB 渲染时**只提取纯文本**（textContent），不注入原始 HTML，天然免疫 EPUB 内嵌脚本（XSS）

### 3.2 TXT 编码检测（Windows 中文场景）
```
Buffer ──> TextDecoder('utf-8', {fatal:true})   严格解码，非法字节即抛错
        ──失败──> TextDecoder('gbk')             中文 Windows 记事本默认编码
        ──失败──> buf.toString('utf8')           最终兜底
```
严格 UTF-8 是关键：普通解码遇到 GBK 字节会产生「锟斤拷」式静默乱码，严格模式则能明确判断。

### 3.3 TXT 智能分章（v1.1）
正则识别常见章节标题行：

```
第[一二三四五六七八九十百千万零〇0-9两]+[章回卷节部篇集话] ｜ Chapter N ｜ 序章/楔子/引子/尾声/番外
```
按行扫描，命中即开新章；首个标题前的内容归入「开篇」；全文无标记则整本单章。

### 3.4 EPUB 解析流程（v1.1）
```
epub(zip)
 ├─ META-INF/container.xml ──full-path──> content.opf
 ├─ OPF: <manifest> 建 id→href 映射；<spine> 给出阅读顺序
 └─ 按 spine 逐节：读 XHTML → DOMParser → 取 h1~h6/<title> 作章节名
                → 移除 script/style → 取叶子级块元素 textContent 作段落
```
健壮性：找不到 OPF / 正文为空时抛出可读错误信息，前端 toast 提示，不白屏。

### 3.5 进度模型（v1.1 精确到章）
```
er_prog_<bookId> = { ci: 当前章下标, scrollPct: 章内滚动百分比 }
书架显示百分比 = (ci + scrollPct/100) / 总章数 × 100%
```
- bookId = base64(path|size)：同书重导不重复；文件被替换（大小变化）视为新书
- 书籍正文**永不写入 localStorage**（防配额爆），按 path 从磁盘重读；文件丢失给出明确提示
- 返回书架时把整书百分比写回元数据并重渲染 —— 修复 v1.0 常见的「返回后进度不更新」Bug

### 3.6 三主题实现
`body[data-theme]` + CSS 自定义属性三套取值，切换即改 data 属性；阅读区颜色全部走变量，无一行硬编码色值。

## 四、测试记录

| 用例 | 输入 | 期望 | 结果 |
|---|---|---|---|
| T1 GBK 编码 | 记事本 ANSI 编码 TXT | 正常显示中文 | ✅ |
| T2 重复导入 | 同一文件导两次 | 书架仅一条 | ✅ |
| T3 进度恢复 | 读到第 3 章 40% 处关闭重开 | 定位回第 3 章原位置 | ✅ |
| T4 书架刷新 | 阅读后返回书架 | 卡片百分比立即更新 | ✅ |
| T5 TXT 分章 | 含「第一章~第五章」文本 | 分出 5 章，目录可跳 | ✅ |
| T6 EPUB 导入 | 标准 EPUB 2/3 | 按节出目录，正文可读 | ✅ |
| T7 损坏 EPUB | 随便改后缀的 zip | toast「解析失败」，不崩溃 | ✅ |
| T8 主题记忆 | 切到暗夜后重启 | 仍为暗夜 | ✅ |
| T9 翻章边界 | 第一章按 ← | 提示「已经是第一章」 | ✅ |
| T10 统计 | 阅读 >1 分钟回书架 | 显示「今日已读 N 分钟」 | ✅ |

## 五、打包与分发
```bash
npm run pack   # electron-packager 输出 dist/飞扬阅读器-win32-x64/
```
把该目录压缩发给朋友，解压双击「飞扬阅读器.exe」即可使用，无需安装 Node 或任何运行时。
