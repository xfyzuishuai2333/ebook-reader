// ================= 飞扬阅读器 · 主进程（v1.1） =================
// 迭代内容：支持 EPUB 导入、内置示例书
// 职责：创建窗口、文件对话框、读取磁盘文件、TXT 编码检测
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC：选择并导入书籍（v1.1 支持 TXT + EPUB） ----------
ipcMain.handle('dialog:openBook', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入电子书（TXT / EPUB）',
    filters: [
      { name: '电子书', extensions: ['txt', 'epub'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'EPUB 电子书', extensions: ['epub'] }
    ],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return readBookFile(res.filePaths[0]);
});

// ---------- IPC：按路径重新读取（书架继续阅读） ----------
ipcMain.handle('book:readByPath', async (_e, bookPath) => {
  try {
    if (!fs.existsSync(bookPath)) return { error: '文件不存在，可能已被移动或删除' };
    return readBookFile(bookPath);
  } catch (err) {
    return { error: '读取失败：' + err.message };
  }
});

// ---------- IPC：载入内置示例书（免找文件，开箱体验） ----------
ipcMain.handle('book:loadSample', async () => {
  const p = path.join(__dirname, 'assets', 'sample.txt');
  const buf = fs.readFileSync(p);
  return {
    format: 'txt',
    name: '星海拾光（示例书）',
    path: p,
    size: buf.length,
    text: decodeText(buf)
  };
});

// 统一的书籍文件读取：txt 走编码检测返回 text；epub 返回 base64 交给渲染层 JSZip 解析
function readBookFile(p) {
  const ext = path.extname(p).toLowerCase();
  const buf = fs.readFileSync(p);
  const base = {
    name: path.basename(p, ext),
    path: p,
    size: buf.length
  };
  if (ext === '.epub') {
    return { ...base, format: 'epub', data: buf.toString('base64') };
  }
  return { ...base, format: 'txt', text: decodeText(buf) };
}

// ---------- 编码检测：UTF-8 严格模式失败 → GBK 兜底 ----------
function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (e2) {
      return buf.toString('utf8');
    }
  }
}
