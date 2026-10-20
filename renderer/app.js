// ================= 飞扬阅读器 · 渲染层逻辑（v1.1） =================
// v1.0：书架、TXT 导入、进度记忆
// v1.1 迭代新增：EPUB 导入、目录切章、TXT 智能分章、三主题、字号调节、
//               阅读统计、示例书、键盘翻章、沉浸模式

const LS_BOOKS = 'er_books';
const LS_THEME = 'er_theme';
const LS_FONT = 'er_font';
const LS_STATS = 'er_stats';

// ---------- 状态 ----------
let books = loadBooks();
let currentBook = null;          // {id,name,path,format,chapters,ci}
let statTimer = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const shelfView = $('shelfView'), readerView = $('readerView');
const bookGrid = $('bookGrid'), emptyTip = $('emptyTip');
const readerScroll = $('readerScroll'), readerContent = $('readerContent');
const readerTitle = $('readerTitle'), chapterTitle = $('chapterTitle'), readerPct = $('readerPct');
const tocPanel = $('tocPanel'), tocList = $('tocList'), tocCount = $('tocCount');
const chapterPos = $('chapterPos');

// ================= 工具函数 =================
function loadBooks() {
  try { return JSON.parse(localStorage.getItem(LS_BOOKS)) || []; }
  catch (e) { return []; }
}
function saveBooks() {
  localStorage.setItem(LS_BOOKS, JSON.stringify(books));
}
function genId(meta) {
  return btoa(unescape(encodeURIComponent(meta.path + '|' + meta.size))).replace(/=/g, '');
}
function fmtTime(ts) {
  if (!ts) return '未读过';
  const d = new Date(ts), now = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `今天 ${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function fmtSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
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

// ================= 文本解析 =================

// TXT 智能分章：识别「第一章 / 第12回 / Chapter 3 / 序章 / 楔子」等常见章节标题行
function parseTxtChapters(text) {
  const re = /^\s*(第\s*[一二三四五六七八九十百千万零〇0-9两]+\s*[章回卷节部篇集话][^\n]{0,30}|[Cc]hapter\s+\d+[^\n]{0,40}|序章|序言|楔子|引子|尾声|终章|后记|番外[^\n]{0,20})\s*$/;
  const lines = text.split(/\r?\n/);
  const chapters = [];
  let cur = null;

  for (const line of lines) {
    if (re.test(line.trim())) {
      if (cur) chapters.push(cur);              // 收起上一章
      cur = { title: line.trim().slice(0, 40), content: '' };
    } else if (cur) {
      cur.content += line + '\n';
    } else {
      // 第一个章节标题之前的内容（如书名、作者），单独放一章
      if (line.trim()) {
        if (!cur) cur = { title: '开篇', content: '' };
        cur.content += line + '\n';
      }
    }
  }
  if (cur) chapters.push(cur);

  // 全文没有任何章节标记 → 作为单章处理
  if (chapters.length === 1) chapters[0].title = '全文';
  return chapters.length ? chapters : [{ title: '全文', content: text }];
}

// EPUB 解析：zip → container.xml → OPF → spine 顺序逐节提取标题与正文
async function parseEpub(bytes) {
  const zip = await JSZip.loadAsync(bytes);

  // 1. container.xml 里找到 OPF 包文件路径
  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const opfPath = (containerXml.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error('无效的 EPUB：找不到 OPF');

  // 2. 解析 OPF：manifest（id → 文件）+ spine（阅读顺序）
  const opf = await zip.file(opfPath).async('string');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const doc = new DOMParser().parseFromString(opf, 'application/xml');

  const manifest = {};
  doc.querySelectorAll('manifest > item').forEach(it => {
    manifest[it.getAttribute('id')] = {
      href: it.getAttribute('href'),
      type: it.getAttribute('media-type') || ''
    };
  });
  const refs = [...doc.querySelectorAll('spine > itemref')].map(ir => ir.getAttribute('idref'));

  // 3. 按 spine 顺序读取每节 XHTML，提取标题 + 正文段落
  const chapters = [];
  for (const ref of refs) {
    const item = manifest[ref];
    if (!item || !/x?html/.test(item.type)) continue;
    const entry = zip.file(opfDir + decodeURIComponent(item.href));
    if (!entry) continue;
    const html = await entry.async('string');
    const xdoc = new DOMParser().parseFromString(html, 'text/html');

    // 标题：优先 h1-h6，退而求其次 <title>
    const h = xdoc.querySelector('h1,h2,h3,h4,h5,h6');
    const tEl = xdoc.querySelector('title');
    const title = ((h && h.textContent.trim()) || (tEl && tEl.textContent.trim()) || `第 ${chapters.length + 1} 节`).slice(0, 40);

    // 正文：移除脚本样式后，取叶子级块元素的文本
    xdoc.querySelectorAll('script,style,link,nav').forEach(n => n.remove());
    const paras = [];
    xdoc.body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,td').forEach(el => {
      if (el.querySelector('p,div,td,li')) return;   // 含子容器的跳过，避免重复
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t) paras.push(t);
    });
    if (!paras.length) {
      const t = xdoc.body.textContent.replace(/\s+/g, ' ').trim();
      if (t) paras.push(t);
    }
    if (paras.length) chapters.push({ title, content: paras.join('\n\n') });
  }

  if (!chapters.length) throw new Error('EPUB 解析失败：未找到正文');
  return chapters;
}

// 正文渲染：把章节文本转成 <p> 段落
function renderParas(text) {
  return text.split(/\n\s*\n|\r\n\s*\r\n/)
    .map(s => s.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

// ================= 主题 / 字号（v1.1） =================
const THEMES = ['light', 'sepia', 'dark'];
function applyTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem(LS_THEME, t);
}
function initSettings() {
  applyTheme(THEMES.includes(localStorage.getItem(LS_THEME)) ? localStorage.getItem(LS_THEME) : 'light');
  const font = parseInt(localStorage.getItem(LS_FONT));
  if (font >= 14 && font <= 28) document.documentElement.style.setProperty('--reader-font-size', font + 'px');
}
$('btnTheme').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(document.body.dataset.theme) + 1) % THEMES.length];
  applyTheme(next);
  showToast({ light: '☀️ 白色主题', sepia: '🌾 护眼主题', dark: '🌙 暗夜主题' }[next]);
});
$('btnFontUp').addEventListener('click', () => stepFont(1));
$('btnFontDown').addEventListener('click', () => stepFont(-1));
function stepFont(dir) {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reader-font-size'));
  const next = Math.min(28, Math.max(14, cur + dir * 2));
  document.documentElement.style.setProperty('--reader-font-size', next + 'px');
  localStorage.setItem(LS_FONT, next);
}

// ================= 阅读统计（v1.1 创新点） =================
// 阅读视图打开期间每秒 +1，按天存储；书架展示「今日阅读 N 分钟」
function statsTick() {
  const today = new Date().toISOString().slice(0, 10);
  let s;
  try { s = JSON.parse(localStorage.getItem(LS_STATS)) || {}; } catch (e) { s = {}; }
  if (s.date !== today) s = { date: today, seconds: 0 };
  s.seconds += 1;
  localStorage.setItem(LS_STATS, JSON.stringify(s));
}
function renderTodayStats() {
  let s;
  try { s = JSON.parse(localStorage.getItem(LS_STATS)) || {}; } catch (e) { s = {}; }
  const today = new Date().toISOString().slice(0, 10);
  const mins = s.date === today ? Math.floor(s.seconds / 60) : 0;
  $('todayStats').textContent = mins > 0 ? `⏱ 今日已读 ${mins} 分钟` : '';
}

// ================= 书架 =================
function renderShelf() {
  bookGrid.innerHTML = '';
  emptyTip.style.display = books.length ? 'none' : 'block';
  renderTodayStats();

  const sorted = [...books].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
  sorted.forEach(book => {
    const card = document.createElement('div');
    card.className = 'book-card';
    const pct = Math.round(book.progressPct || 0);
    const first = escapeHtml(book.name.slice(0, 1));
    const badge = book.format === 'epub' ? 'EPUB' : 'TXT';
    card.innerHTML = `
      <button class="book-remove" title="移出书架">✕</button>
      <div class="book-cover">${first}</div>
      <div class="book-name" title="${escapeHtml(book.name)}">${escapeHtml(book.name)}</div>
      <div class="book-meta">${badge} · ${fmtSize(book.size)} · ${fmtTime(book.lastReadAt)}</div>
      <div class="book-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-text">已读 ${pct}%${book.chapterCount ? ' · ' + book.chapterCount + ' 章' : ''}</div>
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

// 把某一章的滚动百分比换算成整书百分比
function overallPct(book, ci, scrollPct) {
  const total = book.chapterCount || (book.chapters ? book.chapters.length : 1);
  const within = (scrollPct || 0) / 100;
  return Math.min(100, Math.round(((ci + within) / Math.max(1, total)) * 100));
}

// ================= 导入 =================
async function importFrom(res) {
  if (!res) return;                        // 用户取消
  if (res.error) return showToast(res.error);

  const meta = { name: res.name, path: res.path, size: res.size, format: res.format };
  const id = genId(meta);
  let book = books.find(b => b.id === id);
  if (!book) {
    book = { id, ...meta, addedAt: Date.now(), lastReadAt: 0, progressPct: 0 };
    books.push(book);
    saveBooks();
  }
  renderShelf();
  await openBook(book, res);               // 导入后直接进入阅读
}

$('btnImport').addEventListener('click', async () => {
  importFrom(await window.ebook.openBook());
});
$('btnSample').addEventListener('click', async () => {
  importFrom(await window.ebook.loadSample());
});

// ================= 打开阅读 =================
async function openBook(book, preloaded) {
  // 1. 取内容：优先用导入时已读入的数据，否则按路径重读
  let data = preloaded;
  if (!data) {
    data = book.format === 'epub'
      ? await window.ebook.readByPath(book.path)
      : await window.ebook.readByPath(book.path);
    if (!data || data.error) return showToast((data && data.error) || '打开失败');
  }

  // 2. 解析章节
  let chapters;
  try {
    if (data.format === 'epub') {
      const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
      chapters = await parseEpub(bytes);
    } else {
      chapters = parseTxtChapters(data.text);
    }
  } catch (err) {
    return showToast('解析失败：' + err.message);
  }

  currentBook = { ...book, chapters };
  // 章节数写回书架元数据，进度百分比从此可精确到章
  const b = books.find(x => x.id === book.id);
  if (b && b.chapterCount !== chapters.length) { b.chapterCount = chapters.length; saveBooks(); }

  // 3. UI 切换 + 目录渲染
  shelfView.hidden = true; readerView.hidden = false;
  readerTitle.textContent = book.name;
  tocCount.textContent = `共 ${chapters.length} 章`;
  renderToc();

  // 4. 恢复进度：先到上次章节，再恢复章内滚动位置
  const prog = loadProgress(book.id);
  const ci = Math.min(prog.ci || 0, chapters.length - 1);
  await renderChapter(ci, false);

  const max = readerScroll.scrollHeight - readerScroll.clientHeight;
  const target = ((prog.scrollPct || 0) / 100) * max;
  readerScroll.scrollTop = Math.max(0, target);

  // 5. 开始计时统计
  b && (b.lastReadAt = Date.now()); saveBooks();
  clearInterval(statTimer);
  statTimer = setInterval(statsTick, 1000);
}

// ================= 目录（v1.1） =================
function renderToc() {
  tocList.innerHTML = '';
  currentBook.chapters.forEach((ch, i) => {
    const item = document.createElement('div');
    item.className = 'toc-item' + (i === currentBook.ci ? ' active' : '');
    item.innerHTML = `<span class="toc-idx">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(ch.title || '未命名章节')}`;
    item.addEventListener('click', () => {
      renderChapter(i, true);
      toggleToc(false);           // 手机式交互：选中后自动收起目录
    });
    tocList.appendChild(item);
  });
}
$('btnToc').addEventListener('click', () => toggleToc());
function toggleToc(force) {
  const show = force !== undefined ? force : tocPanel.hidden;
  tocPanel.hidden = !show;
}

// ================= 章节渲染与切换 =================
async function renderChapter(ci, scrollToTop) {
  const ch = currentBook.chapters[ci];
  currentBook.ci = ci;
  chapterTitle.textContent = ch.title || `第 ${ci + 1} 节`;
  readerContent.innerHTML = renderParas(ch.content);
  chapterPos.textContent = `${ci + 1} / ${currentBook.chapters.length} 章`;

  // 目录高亮同步
  tocList.querySelectorAll('.toc-item').forEach((el, i) => el.classList.toggle('active', i === ci));
  const active = tocList.querySelector('.toc-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });

  if (scrollToTop) readerScroll.scrollTop = 0;
  saveProgress();               // 切章即存进度
}

// 章节内滚动 → 节流保存
let scrollTimer = null;
readerScroll.addEventListener('scroll', () => {
  if (!currentBook) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveProgress, 400);
});

function saveProgress() {
  if (!currentBook) return;
  const max = readerScroll.scrollHeight - readerScroll.clientHeight;
  const pct = max > 0 ? Math.min(100, readerScroll.scrollTop / max * 100) : 0;
  localStorage.setItem('er_prog_' + currentBook.id, JSON.stringify({ ci: currentBook.ci, scrollPct: pct }));
  // 顶栏百分比 = 整书进度
  readerPct.textContent = overallPct(currentBook, currentBook.ci, pct) + '%';
}
function loadProgress(id) {
  try { return JSON.parse(localStorage.getItem('er_prog_' + id)) || {}; }
  catch (e) { return {}; }
}

// 上一章 / 下一章
$('btnPrev').addEventListener('click', () => stepChapter(-1));
$('btnNext').addEventListener('click', () => stepChapter(1));
function stepChapter(d) {
  if (!currentBook) return;
  const next = currentBook.ci + d;
  if (next < 0) return showToast('已经是第一章');
  if (next >= currentBook.chapters.length) return showToast('已经是最后一章');
  renderChapter(next, true);
}

// 键盘：← → 翻章，F11 沉浸模式，Esc 退出
window.addEventListener('keydown', (e) => {
  if (readerView.hidden) return;
  if (e.key === 'ArrowLeft') stepChapter(-1);
  else if (e.key === 'ArrowRight') stepChapter(1);
  else if (e.key === 'F11') { e.preventDefault(); document.body.classList.toggle('immersive'); }
  else if (e.key === 'Escape') document.body.classList.remove('immersive');
});

// ================= 返回书架 =================
$('btnBack').addEventListener('click', () => {
  saveProgress();
  // 关键修复：返回前把整书百分比写回书架元数据并重渲染，书架进度即时刷新
  const b = books.find(x => x.id === currentBook.id);
  if (b) {
    const max = readerScroll.scrollHeight - readerScroll.clientHeight;
    const pct = max > 0 ? Math.min(100, readerScroll.scrollTop / max * 100) : 0;
    b.progressPct = overallPct(currentBook, currentBook.ci, pct);
    b.lastReadAt = Date.now();
    saveBooks();
  }
  clearInterval(statTimer);
  renderTodayStats();
  currentBook = null;
  readerView.hidden = true; shelfView.hidden = false;
  renderShelf();
});

// ================= 启动 =================
initSettings();
renderShelf();
