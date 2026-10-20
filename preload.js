// ================= 预加载脚本（安全桥） =================
// 通过 contextBridge 把主进程能力以受控方式暴露给页面，
// 避免开启 nodeIntegration 造成安全风险
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ebook', {
  // 弹出系统文件对话框选择书籍（txt/epub）
  openBook: () => ipcRenderer.invoke('dialog:openBook'),
  // 按磁盘路径重新读取书籍内容（书架继续阅读）
  readByPath: (p) => ipcRenderer.invoke('book:readByPath', p),
  // 载入内置示例书
  loadSample: () => ipcRenderer.invoke('book:loadSample')
});
