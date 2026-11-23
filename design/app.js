/* 墨纸 Mozhi Reader — 原型交互脚本（vanilla JS） */
(function () {
  'use strict';

  /* ---------- SVG 图标 ---------- */
  const icon = (paths) =>
    `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    rss: icon('<circle cx="5.2" cy="14.8" r="1.3" fill="currentColor" stroke="none"/><path d="M5.2 9.6a5.2 5.2 0 0 1 5.2 5.2"/><path d="M5.2 4.8a10 10 0 0 1 10 10"/>'),
    web: icon('<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.6 2.5 11.4 0 14M10 3c-2.5 2.6-2.5 11.4 0 14"/>'),
    api: icon('<path d="M6.5 13.5 3.5 10l3-3"/><path d="M13.5 6.5l3 3.5-3 3"/><path d="M11.5 4.5l-3 11"/>'),
    refresh: icon('<path d="M16 10a6 6 0 1 1-1.8-4.2"/><path d="M16 3.5V7h-3.5"/>'),
    check: icon('<path d="M4 10.5 8 14.5 16 5.5"/>'),
  };

  /* ---------- 种子数据 ---------- */
  const books = [
    { id: 'b1', title: '朝花夕拾', author: '鲁迅', type: 'book', fmt: 'EPUB', cover: 1, progress: 62, chapter: '第三章' },
    { id: 'b2', title: '呐喊', author: '鲁迅', type: 'book', fmt: 'EPUB', cover: 0, progress: 0, chapter: '' },
    { id: 'b3', title: '城南旧事', author: '林海音', type: 'book', fmt: 'PDF', cover: 2, progress: 34, chapter: '第二章' },
    { id: 'b4', title: '世说新语', author: '刘义庆', type: 'book', fmt: 'EPUB', cover: 3, progress: 0, chapter: '' },
    { id: 'b5', title: '唐诗三百首', author: '蘅塘退士', type: 'book', fmt: 'TXT', cover: 4, progress: 18, chapter: '五言古诗' },
    { id: 'b6', title: '浮生六记', author: '沈复', type: 'book', fmt: 'EPUB', cover: 2, progress: 100, chapter: '卷六' },
  ];
  const articles = [
    { id: 'a1', title: '第 305 期：AI 与阅读的未来', source: '科技爱好者周刊', date: '11-10', type: 'article', unread: true, progress: 0 },
    { id: 'a2', title: '把 RSS 作为一种生活方式', source: '阮一峰周刊', date: '11-09', type: 'article', unread: true, progress: 0 },
    { id: 'a3', title: '为什么我还在写博客', source: '少数派', date: '11-09', type: 'article', unread: true, progress: 0 },
    { id: 'a4', title: '本地优先软件的十年', source: '科技爱好者周刊', date: '11-08', type: 'article', unread: true, progress: 38 },
    { id: 'a5', title: '从纸到屏：阅读介质小史', source: '少数派', date: '11-07', type: 'article', unread: false, progress: 100 },
    { id: 'a6', title: 'PDF 重排版的一次尝试', source: '阮一峰周刊', date: '11-06', type: 'article', unread: false, progress: 100 },
  ];
  let sources = [
    { id: 's1', name: '科技爱好者周刊', url: 'rsshub.app/ruanyifeng', type: 'rss', interval: '6小时', lastPull: '2 小时前', lastCount: 3, on: true },
    { id: 's2', name: '阮一峰周刊', url: 'ruanyifeng.com', type: 'rss', interval: '1小时', lastPull: '40 分钟前', lastCount: 1, on: true },
    { id: 's3', name: '少数派', url: 'sspai.com', type: 'rss', interval: '30分钟', lastPull: '25 分钟前', lastCount: 0, on: true },
    { id: 's4', name: '某独立博客', url: 'blog.example.com', type: 'web', interval: '仅手动', lastPull: '3 天前', lastCount: 2, on: false },
  ];
  const PULL_TITLES = ['RSS 依旧是最好的答案', '重新发现本地存储', '电子墨水的十年回顾', '告别算法时间线', '慢阅读实验手记'];
  let pullTitleIdx = 0;
  let nextId = 100;

  /* ---------- 阅读正文模板 ---------- */
  const CONGCONG = [
    '燕子去了，有再来的时候；杨柳枯了，有再青的时候；桃花谢了，有再开的时候。但是，聪明的，你告诉我，我们的日子为什么一去不复返呢？——是有人偷了他们罢：那是谁？又藏在何处呢？是他们自己逃走了罢：现在又到了哪里呢？',
    '我不知道他们给了我多少日子；但我的手确乎是渐渐空虚了。在默默里算着，八千多日子已经从我手中溜去；像针尖上一滴水滴在大海里，我的日子滴在时间的流里，没有声音，也没有影子。我不禁头涔涔而泪潸潸了。',
    '去的尽管去了，来的尽管来着；去来的中间，又怎样地匆匆呢？早上我起来的时候，小屋里射进两三方斜斜的太阳。太阳他有脚啊，轻轻悄悄地挪移了；我也茫茫然跟着旋转。于是——洗手的时候，日子从水盆里过去；吃饭的时候，日子从饭碗里过去；默默时，便从凝然的双眼前过去。',
    '我觉察他去的匆匆了，伸出手遮挽时，他又从遮挽着的手边过去；天黑时，我躺在床上，他便伶伶俐俐地从我身上跨过，从我脚边飞去了。等我睁开眼和太阳再见，这算又溜走了一日。我掩着面叹息。但是新来的日子的影儿又开始在叹息里闪过了。',
    '在逃去如飞的日子里，在千门万户的世界里的我能做些什么呢？只有徘徊罢了，只有匆匆罢了；在八千多日的匆匆里，除徘徊外，又剩些什么呢？过去的日子如轻烟，被微风吹散了，如薄雾，被初阳蒸融了；我留着些什么痕迹呢？我何曾留着像游丝样的痕迹呢？我赤裸裸来到这世界，转眼间也将赤裸裸的回去罢？但不能平的，为什么偏要白白走这一遭啊？',
    '你聪明的，告诉我，我们的日子为什么一去不复返呢？',
  ];
  const CHAPTER_NAMES = ['一', '二', '三', '四', '五', '尾声'];
  function bookHtml() {
    let out = '';
    CONGCONG.forEach((text, i) => {
      out += `<section data-ch="${i}"><h2 class="chapter-title">${CHAPTER_NAMES[i]}</h2><p>${text}</p>`;
      if (i === 2) out += `<p class="pull-quote">燕子去了，有再来的时候；杨柳枯了，有再青的时候；桃花谢了，有再开的时候。</p>`;
      out += `</section>${i < CONGCONG.length - 1 ? '<p class="fleuron">✳</p>' : ''}`;
    });
    return out;
  }
  function articleHtml(item) {
    return `<h2>${item.title}</h2><p class="article-meta">${item.source} · ${item.date} · 约 4 分钟</p>` +
      '<p>工具的意义不在于它添加了多少功能，而在于它替你挡掉了多少噪音。一个只做阅读的应用，把订阅、抓取、排版这些琐事收拢在一起，剩下的时间还给内容本身。</p>' +
      '<p>我们习惯了在浏览器里被各种通知打断，习惯了在信息流里滑得停不下来。而当文字被重新放进一页安静的纸面，字号、行距、纸色都随你心意，阅读这件事忽然又变得郑重起来。</p>' +
      '<p>这篇短文只是占位示例。真正的正文会在拉取完成后经过正文提取，去掉导航、广告与脚本，只留下作者写下的那些句子。</p>';
  }

  /* ---------- 状态 ---------- */
  const state = { view: 'shelf', filter: 'all', currentId: null, readSize: 17, readLh: '1.9' };

  /* ---------- 工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function today() { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  function toast(title, sub) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${ICONS.check}<div><b></b><span></span></div>`;
    $('b', el).textContent = title;
    $('span', el).textContent = sub || '';
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 320); }, 3200);
  }

  function setView(name) {
    state.view = name;
    document.body.dataset.view = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  }

  function allItems() { return [...articles, ...books]; }
  function unreadCount() { return articles.filter((a) => a.unread).length; }
  function findItem(id) { return allItems().find((x) => x.id === id); }

  /* ---------- 渲染：书架 ---------- */
  function renderShelf() {
    const grid = $('#shelf-grid');
    const items = allItems().filter((x) => state.filter === 'all' || x.type === state.filter);
    grid.innerHTML = items.length ? items.map(cardHtml).join('') : '这里还没有内容';
    $('#shelf-stats').textContent = `${books.length} 本图书 · ${articles.length} 篇文章 · ${unreadCount()} 篇未读`;
    $('#nav-unread').textContent = unreadCount();
  }
  function cardHtml(item) {
    const isNew = item.isNew ? ' is-new' : '';
    if (item.type === 'book') {
      return `<article class="card book${isNew}" data-id="${item.id}" tabindex="0">
        <div class="cover cover-${item.cover}">
          <span class="cover-title">${item.title}</span>
          <span class="cover-author">${item.author}</span>
          <span class="cover-fmt">${item.fmt}</span>
        </div>
        <h3 class="card-title">${item.title}</h3>
        <p class="card-meta">${item.chapters ? `共 ${item.chapters.length} 章 · ${item.progress ? item.chapters[item.chapterIdx].title.slice(0, 12) + ' ' + item.progress + '%' : '未开始'}` : `${item.author} · ${item.progress ? '已读 ' + item.progress + '%' : '未开始'}`}</p>
        ${item.progress ? `<div class="progress"><i style="width:${item.progress}%"></i></div>` : ''}
      </article>`;
    }
    return `<article class="card article${isNew}" data-id="${item.id}" tabindex="0">
      <div class="cover">
        <span class="cover-src">${item.source}</span>
        <span class="cover-title">${item.title}</span>
        ${item.unread ? '<span class="dot"></span>' : ''}
      </div>
      <h3 class="card-title">${item.title}</h3>
      <p class="card-meta">${item.source} · ${item.date}</p>
      ${item.progress ? `<div class="progress"><i style="width:${item.progress}%"></i></div>` : ''}
    </article>`;
  }

  /* ---------- 渲染：订阅 ---------- */
  function renderSources() {
    $('#source-list').innerHTML = sources.map((s) => {
      const dis = s.on ? '' : ' disabled';
      const status = s.pulling
        ? `<span class="loading">${ICONS.refresh}正在拉取…</span>`
        : s.pulled
          ? `<b class="ok">✓ 刚刚</b> · +${s.lastCount}`
          : `上次 ${s.lastPull} · +${s.lastCount}`;
      return `<div class="source-row${dis}" data-id="${s.id}">
        <span class="src-icon">${ICONS[s.type] || ICONS.rss}</span>
        <div class="src-main">
          <div class="src-name">${s.name}${s.on ? '' : ' · 已暂停'}</div>
          <div class="src-url">${s.url}</div>
        </div>
        <select class="src-interval" aria-label="拉取间隔">${['15分钟', '30分钟', '1小时', '6小时', '12小时', '每天', '仅手动']
          .map((v) => `<option${v === s.interval ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <span class="src-status">${status}</span>
        <button class="switch${s.on ? ' on' : ''}" data-id="${s.id}" type="button" aria-label="启用开关"><i></i></button>
        <button class="btn ghost btn-pull" data-id="${s.id}" type="button" ${s.pulling ? 'disabled' : ''}>立即拉取</button>
      </div>`;
    }).join('');
  }

  /* ---------- 渲染：阅读器 ---------- */
  function openReader(id) {
    const item = findItem(id);
    if (!item) return;
    state.currentId = id;
    if (item.type === 'article' && item.unread) { item.unread = false; renderShelf(); }
    $('#reader-title').textContent = item.title;
    if (item.chapters) {
      item.chapterIdx = item.chapterIdx || 0;
      $('#reader-chapter').textContent = `${item.author} · ${item.fmt} · 共 ${item.chapters.length} 章`;
      renderTocList(item);
      setView('reader');
      loadChapter(item.chapterIdx, item.progress || 0);
      return;
    }
    $('#reader-chapter').textContent = item.type === 'book' ? (item.author + ' · ' + item.fmt) : (item.source + ' · ' + item.date);
    $('#reader-content').innerHTML = item.type === 'book' ? bookHtml() : articleHtml(item);
    $('#reader-toc').innerHTML = (item.type === 'book' ? CHAPTER_NAMES : ['全文'])
      .map((n, i) => `<button class="toc-item${i === 0 ? ' current' : ''}" data-ch="${i}" type="button">${n}</button>`).join('');
    setView('reader');
    const sc = $('#reader-scroll');
    requestAnimationFrame(() => { sc.scrollTop = item.progress ? (sc.scrollHeight - sc.clientHeight) * item.progress / 100 : 0; });
  }
  function closeReader() {
    const item = findItem(state.currentId);
    if (item) {
      const sc = $('#reader-scroll');
      const p = sc.scrollHeight > sc.clientHeight ? Math.round(sc.scrollTop / (sc.scrollHeight - sc.clientHeight) * 100) : 100;
      item.progress = p;
      if (item.chapters) {
        item.chapter = item.chapters[item.chapterIdx].title.slice(0, 16);
        toast('已保存阅读进度', `${item.title} · ${item.chapter} ${p}%`);
      } else {
        if (item.type === 'book') item.chapter = p >= 100 ? '读完' : CHAPTER_NAMES[Math.min(Math.floor(p / 20), 5)];
        toast('已保存阅读进度', `${item.title} · ${p}%`);
      }
      renderShelf();
    }
    setView('shelf');
  }
  function updateReaderProgress() {
    const sc = $('#reader-scroll');
    const p = sc.scrollHeight > sc.clientHeight ? Math.min(100, Math.round(sc.scrollTop / (sc.scrollHeight - sc.clientHeight) * 100)) : 100;
    $('#reader-progress-text').textContent = p + '%';
    $('#reader-progress-bar').style.width = p + '%';
    const item = findItem(state.currentId);
    const cur = item && item.chapters ? item.chapterIdx : Math.min(Math.floor(p / 20), 5);
    $$('.toc-item').forEach((t) => t.classList.toggle('current', +t.dataset.ch === cur));
  }

  /* ---------- 拉取 ---------- */
  function pullSource(id, silent) {
    const s = sources.find((x) => x.id === id);
    if (!s || s.pulling) return Promise.resolve(0);
    s.pulling = true; s.pulled = false; renderSources();
    return new Promise((resolve) => {
      setTimeout(() => {
        s.pulling = false; s.pulled = true; s.lastPull = '刚刚'; s.lastCount = 2;
        for (let i = 0; i < 2; i++) {
          articles.unshift({ id: 'a' + (nextId++), title: PULL_TITLES[pullTitleIdx++ % PULL_TITLES.length], source: s.name, date: today(), type: 'article', unread: true, progress: 0, isNew: true });
        }
        renderSources(); renderShelf();
        if (!silent) toast(`${s.name} · 新增 2 篇`, '文章已加入书架');
        resolve(2);
      }, 1400);
    });
  }

  /* ---------- 本地导入（txt/md） ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CH_RE = /^\s*(第[0-9零〇一二三四五六七八九十百千万两]{1,12}[章节卷回部集话話](?:[\s:：、.．\-—·]{0,3}\S{0,26})?|序章|楔子|引子|尾声|终章|后记|番外)\s*$/;

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('gb18030').decode(buf); }
  }
  const AD_SITE_RE = /https?:\/\/|www\.|[\w-]+\.(com|net|tw|cc|org|me)|爱下电子书|更多电子书|请访问|TXT下载|txt下载/i;
  const AD_RE = new RegExp(AD_SITE_RE.source + '|-{5,}|仅供欣赏|请支持正版', 'i');
  function parseChapters(text) {
    const chapters = [];
    let cur = null;
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.length <= 40 && CH_RE.test(line)) {
        cur = { title: line, paras: [] };
        chapters.push(cur);
      } else {
        if (!cur) { cur = { title: '开篇', paras: [] }; chapters.push(cur); }
        // 全书过滤站点广告行；开篇额外过滤横线/声明行
        if (AD_SITE_RE.test(line)) continue;
        if (chapters.length === 1 && chapters[0].title === '开篇' && AD_RE.test(line)) continue;
        cur.paras.push(line);
      }
    }
    if (chapters.length === 1 && chapters[0].paras.length > 500) {
      // 无章节标记的大文件：按 400 段分页
      const paras = chapters[0].paras; const parts = [];
      for (let i = 0; i < paras.length; i += 400) parts.push(paras.slice(i, i + 400));
      return parts.map((p, i) => ({ title: `开篇 · ${'一二三四五六七八九十'[i % 10]}${i >= 10 ? `(${i + 1})` : ''}`, paras: p }));
    }
    return chapters.filter((c) => c.paras.length || c !== chapters[0]);
  }
  function cleanTitle(name) {
    return (name.replace(/\.(txt|md)$/i, '')
      .replace(/[\s\-_—·]*(免费下载|txt免费|下载|全集|完整版|全本|精校版?|校对版|最新章节|笔趣阁?|顶点小说?)+/gi, ' ')
      .replace(/[\s\-_—·]+/g, ' ').trim()) || name;
  }
  async function importFile(file) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) { toast('暂不支持该格式', '原型支持 .txt / .md'); return; }
    try {
      const text = decodeText(await file.arrayBuffer());
      const chapters = parseChapters(text);
      if (!chapters.length) { toast('文件内容为空', file.name); return; }
      let author = '本地导入';
      for (const line of chapters[0].paras.slice(0, 8)) {
        const m = line.match(/作者[:：]\s*([^\s『』〔〕\[\]\/，,。]{1,20})/);
        if (m) { author = m[1]; break; }
      }
      const book = {
        id: 'b' + (nextId++), title: cleanTitle(file.name), author, type: 'book',
        fmt: file.name.split('.').pop().toUpperCase(), cover: Math.floor(Math.random() * 5),
        progress: 0, chapterIdx: 0, chapters,
      };
      books.unshift(book);
      renderShelf();
      openReader(book.id);
      toast('已导入本地图书', `${book.title} · ${chapters.length} 章`);
    } catch (err) { toast('导入失败', String((err && err.message) || err)); }
  }
  function renderTocList(item) {
    $('#reader-toc').innerHTML = item.chapters
      .map((c, i) => `<button class="toc-item${i === item.chapterIdx ? ' current' : ''}" data-ch="${i}" type="button" title="${esc(c.title)}">${esc(c.title)}</button>`)
      .join('');
  }
  function loadChapter(idx, pct) {
    const item = findItem(state.currentId);
    if (!item || !item.chapters) return;
    idx = Math.max(0, Math.min(item.chapters.length - 1, idx));
    item.chapterIdx = idx;
    const ch = item.chapters[idx];
    const last = item.chapters.length - 1;
    $('#reader-content').innerHTML =
      `<section data-ch="${idx}"><h2 class="chapter-title">${esc(ch.title)}</h2>${ch.paras.map((p) => `<p>${esc(p)}</p>`).join('')}</section>` +
      `<div class="chapter-nav">
        <button class="ghost ch-prev" type="button" ${idx === 0 ? 'disabled' : ''}>← 上一章</button>
        <span class="ch-pos">${idx + 1} / ${last + 1}</span>
        <button class="primary ch-next" type="button" ${idx === last ? 'disabled' : ''}>下一章 →</button>
      </div>`;
    $$('.toc-item').forEach((t) => t.classList.toggle('current', +t.dataset.ch === idx));
    const sc = $('#reader-scroll');
    requestAnimationFrame(() => {
      sc.scrollTop = pct ? (sc.scrollHeight - sc.clientHeight) * pct / 100 : 0;
      updateReaderProgress();
    });
  }

  /* ---------- 事件绑定（委托，一次性） ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    // 侧栏路由
    $$('.nav-item').forEach((n) => n.addEventListener('click', () => setView(n.dataset.view)));

    // 书架 tab
    $('#shelf-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      state.filter = t.dataset.filter;
      $$('#shelf-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      renderShelf();
    });

    // 打开阅读（点击 / 回车）
    $('#shelf-grid').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openReader(c.dataset.id); });
    $('#shelf-grid').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const c = e.target.closest('.card'); if (c) openReader(c.dataset.id);
    });

    // 阅读器
    $('#btn-reader-back').addEventListener('click', closeReader);
    $('#btn-reader-settings').addEventListener('click', () => $('#reader-settings').classList.toggle('open'));
    $('#btn-reader-toc').addEventListener('click', () => $('#reader-toc').classList.toggle('open'));
    $('#reader-content').addEventListener('click', (e) => {
      const prev = e.target.closest('.ch-prev');
      const next = e.target.closest('.ch-next');
      if (prev && !prev.disabled) { loadChapter(-1 + findItem(state.currentId).chapterIdx, 0); return; }
      if (next && !next.disabled) { loadChapter(1 + findItem(state.currentId).chapterIdx, 0); return; }
      if (e.target.closest('.fleuron, .pull-quote')) $('#reader-settings').classList.remove('open');
    });
    // 键盘翻章（仅导入书）
    document.addEventListener('keydown', (e) => {
      if (state.view !== 'reader' || e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const item = findItem(state.currentId);
      if (!item || !item.chapters || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const target = item.chapterIdx + delta;
      if (target >= 0 && target < item.chapters.length) { e.preventDefault(); loadChapter(target, 0); }
    });
    $('#reader-toc').addEventListener('click', (e) => {
      const t = e.target.closest('.toc-item');
      if (!t) return;
      const cur = findItem(state.currentId);
      if (cur && cur.chapters) { loadChapter(+t.dataset.ch, 0); $('#reader-toc').classList.remove('open'); return; }
      $$('.toc-item').forEach((x) => x.classList.toggle('current', x === t));
      const sec = $(`#reader-content section[data-ch="${t.dataset.ch}"]`);
      (sec || $('#reader-content')).scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#reader-toc').classList.remove('open');
    });

    let ticking = false;
    $('#reader-scroll').addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { updateReaderProgress(); ticking = false; });
    });

    // 主题 / 字号 / 行距
    $$('.theme-swatch').forEach((sw) => sw.addEventListener('click', () => {
      document.documentElement.dataset.theme = sw.dataset.theme;
      $$('.theme-swatch').forEach((x) => x.classList.toggle('active', x === sw));
    }));
    const setFont = (v) => {
      state.readSize = Math.max(14, Math.min(22, v));
      document.documentElement.style.setProperty('--read-size', state.readSize + 'px');
      $('#font-val').textContent = state.readSize;
    };
    $('#font-minus').addEventListener('click', () => setFont(state.readSize - 1));
    $('#font-plus').addEventListener('click', () => setFont(state.readSize + 1));
    $$('.lh-opt').forEach((b) => b.addEventListener('click', () => {
      state.readLh = b.dataset.lh;
      document.documentElement.style.setProperty('--read-lh', state.readLh);
      $$('.lh-opt').forEach((x) => x.classList.toggle('active', x === b));
    }));

    // 拉取
    $('#source-list').addEventListener('click', (e) => {
      const pull = e.target.closest('.btn-pull');
      if (pull && !pull.disabled) { pullSource(pull.dataset.id); return; }
      const sw = e.target.closest('.switch');
      if (sw) {
        const s = sources.find((x) => x.id === sw.dataset.id);
        if (s) { s.on = !s.on; renderSources(); }
        return;
      }
      const sel = e.target.closest('.src-interval');
      if (sel) {
        const row = sel.closest('.source-row');
        const s = sources.find((x) => x.id === row.dataset.id);
        if (s) s.interval = sel.value;
      }
    });
    $('#source-list').addEventListener('change', (e) => {
      const sel = e.target.closest('.src-interval');
      if (!sel) return;
      const s = sources.find((x) => x.id === sel.closest('.source-row').dataset.id);
      if (s) s.interval = sel.value;
    });
    $('#btn-pull-all').addEventListener('click', async () => {
      const btn = $('#btn-pull-all');
      btn.disabled = true;
      let total = 0;
      const active = sources.filter((s) => s.on);
      const jobs = active.map((s, i) => new Promise((r) => setTimeout(() => pullSource(s.id, true).then((n) => { total += n; r(); }), i * 300)));
      await Promise.all(jobs);
      btn.disabled = false;
      $('#side-sync').textContent = '上次同步 ' + new Date().toTimeString().slice(0, 5);
      toast('拉取完成', `共新增 ${total} 篇文章`);
    });

    // 添加订阅
    $('#btn-add-source').addEventListener('click', () => { $('#source-form').classList.toggle('hidden'); $('#sf-name').focus(); });
    $('#sf-cancel').addEventListener('click', () => $('#source-form').classList.add('hidden'));
    $('#sf-save').addEventListener('click', () => {
      const name = $('#sf-name'), url = $('#sf-url');
      let ok = true;
      [name, url].forEach((inp) => {
        const bad = !inp.value.trim();
        inp.classList.toggle('error', bad);
        if (bad) { ok = false; setTimeout(() => inp.classList.remove('error'), 600); }
      });
      if (!ok) return;
      const type = $('#sf-type').value;
      let u = url.value.trim();
      if (type === 'web' && !/^https?:/.test(u)) u = 'https://' + u;
      const savedName = name.value.trim();
      sources.unshift({ id: 's' + (nextId++), name: savedName, url: u.replace(/^https?:\/\//, ''), type, interval: $('#sf-interval').value, lastPull: '从未', lastCount: 0, on: true });
      renderSources();
      $('#source-form').classList.add('hidden');
      name.value = ''; url.value = '';
      toast('已添加订阅', savedName);
    });

    // 设置页开关
    $$('.setting-switch').forEach((sw) => sw.addEventListener('click', () => sw.classList.toggle('on')));

    // 本地导入：按钮 + 拖放
    $('#btn-import').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    const dropOv = $('#drop-overlay');
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragDepth++; dropOv.classList.remove('hidden'); }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropOv.classList.add('hidden'); } });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0; dropOv.classList.add('hidden');
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) importFile(f);
    });

    // 初始化
    renderShelf(); renderSources(); setView('shelf');
    document.documentElement.style.setProperty('--read-size', state.readSize + 'px');
    document.documentElement.style.setProperty('--read-lh', state.readLh);
  });
})();
