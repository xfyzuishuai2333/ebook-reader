// ================= 飞扬阅读器 · 渲染层逻辑（v1.0 MVP） =================
// 功能：书架管理、TXT 导入、正文渲染、滚动进度记忆
// 数据全部存 localStorage；书籍正文不落盘（按路径从磁盘重读，避免超出存储配额）

const LS_BOOKS = 'er_books';        // 书架元数据列表

// ---------- 状态 ----------
let books = loadBooks();            // [{id,name,path,size,addedAt,lastReadAt,progressPct}]
let currentBook = null;             // 当前阅读的书（含 text 全文）

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const shelfView = $('shelfView'), readerView = $('readerView');
const bookGrid = $('bookGrid'), emptyTip = $('emptyTip');
const readerScroll = $('readerScroll'), readerContent = $('readerContent');
const readerTitle = $('readerTitle'), readerBookName = $('readerBookName'), readerPct = $('readerPct');

// ---------- 工具 ----------
function loadBooks() {
  try { return JSON.parse(localStorage.getItem(LS_BOOKS)) || []; }
  catch (e) { return []; }
}
function saveBooks() {
  localStorage.setItem(LS_BOOKS, JSON.stringify(books));
}
function genId(book) {
  // 用路径+大小生成稳定 id：同一本书重复导入不会产生重复条目
  return btoa(unescape(encodeURIComponent(book.path + '|' + book.size))).replace(/=/g, '');
}
function fmtTime(ts) {
  if (!ts) return '未读过';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `今天 ${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 2200);
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 书架渲染 ----------
function renderShelf() {
  bookGrid.innerHTML = '';
  emptyTip.style.display = books.length ? 'none' : 'block';

  // 按最近阅读排序：在读的书排在最前
  const sorted = [...books].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));

  sorted.forEach(book => {
    const card = document.createElement('div');
    card.className = 'book-card';
    const pct = Math.round(book.progressPct || 0);
    // 封面色块按书名首字符生成，视觉上区分不同书
    const first = escapeHtml(book.name.slice(0, 1));
    card.innerHTML = `
      <button class="book-remove" title="移出书架">✕</button>
      <div class="book-cover">${first}</div>
      <div class="book-name" title="${escapeHtml(book.name)}">${escapeHtml(book.name)}</div>
      <div class="book-meta">TXT · ${fmtTime(book.lastReadAt)}</div>
      <div class="book-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-text">已读 ${pct}%</div>
      </div>`;
    card.addEventListener('click', () => openBook(book));
    card.querySelector('.book-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      books = books.filter(b => b.id !== book.id);
      saveBooks(); renderShelf();
      showToast('已移出书架');
    });
    bookGrid.appendChild(card);
  });
}

// ---------- 导入 ----------
$('btnImport').addEventListener('click', async () => {
  const res = await window.ebook.openBook();
  if (!res) return;                     // 用户取消
  if (res.error) return showToast(res.error);

  const id = genId(res);
  let book = books.find(b => b.id === id);
  if (!book) {
    book = { id, name: res.name, path: res.path, size: res.size, addedAt: Date.now(), lastReadAt: 0, progressPct: 0 };
    books.push(book);
    saveBooks();
  }
  renderShelf();
  openBook(book, res);                  // 导入后直接进入阅读
});

// ---------- 打开阅读 ----------
async function openBook(book, preloaded) {
  let data = preloaded;
  if (!data) {
    data = await window.ebook.readByPath(book.path);  // 从磁盘重读正文
    if (!data || data.error) {
      showToast((data && data.error) || '打开失败');
      return;
    }
  }

  currentBook = { ...book, text: data.text };
  currentBook._openTs = Date.now();     // 记录开始阅读时间（v1.1 用于统计）

  // 切换视图
  shelfView.hidden = true; readerView.hidden = false;
  readerTitle.textContent = book.name;
  readerBookName.textContent = book.name;

  // 正文渲染：按空行分段，段前空格去除
  const paras = data.text.split(/\n\s*\n|\r\n\s*\r\n/).map(s => s.trim()).filter(Boolean);
  readerContent.innerHTML = paras.map(p => `<p>${escapeHtml(p.replace(/\s*\n\s*/g, ' '))}</p>`).join('');

  // 恢复上次滚动进度
  const prog = loadProgress(book.id);
  const target = (prog.scrollPct || 0) / 100 * (readerScroll.scrollHeight - readerScroll.clientHeight);
  readerScroll.scrollTop = Math.max(0, target);

  // 更新最近阅读时间（回书架时书架进度立即刷新）
  book.lastReadAt = Date.now();
  saveBooks();
}

// 滚动 → 节流保存进度
let scrollTimer = null;
readerScroll.addEventListener('scroll', () => {
  if (!currentBook) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveNow, 400);

  function saveNow() {
    const max = readerScroll.scrollHeight - readerScroll.clientHeight;
    const pct = max > 0 ? Math.min(100, readerScroll.scrollTop / max * 100) : 0;
    localStorage.setItem('er_prog_' + currentBook.id, JSON.stringify({ scrollPct: pct }));
    readerPct.textContent = Math.round(pct) + '%';
  }
});

function loadProgress(id) {
  try { return JSON.parse(localStorage.getItem('er_prog_' + id)) || {}; }
  catch (e) { return {}; }
}

// ---------- 返回书架 ----------
$('btnBack').addEventListener('click', () => {
  // 关键：返回前把内存中的进度写回书架元数据并重渲染书架，
  // 修复「阅读完返回首页后进度没有更新」的常见 Bug
  const max = readerScroll.scrollHeight - readerScroll.clientHeight;
  const pct = max > 0 ? Math.min(100, readerScroll.scrollTop / max * 100) : 0;
  const book = books.find(b => b.id === currentBook.id);
  if (book) {
    book.progressPct = Math.round(pct);
    book.lastReadAt = Date.now();
    saveBooks();
  }
  currentBook = null;
  readerView.hidden = true; shelfView.hidden = false;
  renderShelf();
});

// ---------- 启动 ----------
renderShelf();
