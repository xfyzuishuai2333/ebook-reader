// ================= 飞扬阅读器 · 主进程（v1.0 MVP） =================
// 职责：创建窗口、文件选择对话框、读取磁盘文件并做编码检测
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;

// 创建主窗口
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    autoHideMenuBar: true,          // 隐藏默认菜单栏，界面更简洁
    backgroundColor: '#f7f7f5',     // v1.0 仅白色主题
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,       // 渲染进程与 Node 隔离，安全
      nodeIntegration: false        // 不在页面里直接暴露 Node 能力
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  // macOS 点 Dock 图标时若无窗口则重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Windows/Linux 关闭全部窗口即退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC：选择并导入书籍（v1.0 仅 TXT） ----------
ipcMain.handle('dialog:openBook', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入电子书（TXT）',
    filters: [{ name: '文本电子书', extensions: ['txt'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;

  const p = res.filePaths[0];
  try {
    const buf = fs.readFileSync(p);
    return {
      format: 'txt',
      name: path.basename(p, path.extname(p)), // 去扩展名作为书名
      path: p,
      size: buf.length,
      text: decodeText(buf)                    // 解码后的全文
    };
  } catch (err) {
    return { error: '读取文件失败：' + err.message };
  }
});

// ---------- IPC：按路径重新读取（书架点开旧书时用） ----------
ipcMain.handle('book:readByPath', async (_e, bookPath) => {
  try {
    if (!fs.existsSync(bookPath)) return { error: '文件不存在，可能已被移动或删除' };
    const buf = fs.readFileSync(bookPath);
    return {
      format: 'txt',
      name: path.basename(bookPath, path.extname(bookPath)),
      path: bookPath,
      size: buf.length,
      text: decodeText(buf)
    };
  } catch (err) {
    return { error: '读取失败：' + err.message };
  }
});

// ---------- 编码检测 ----------
// 先用「严格模式 UTF-8」尝试解码：遇到非法字节会抛错；
// 抛错则大概率是 Windows 中文环境常见的 GBK/GB2312 编码
function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(buf); // Electron 内置 full-ICU，支持 GBK
    } catch (e2) {
      return buf.toString('utf8');               // 兜底：直接按 UTF-8 忽略错误
    }
  }
}
