# 墨纸 Mozhi Reader — 交互原型 SPEC（三文件契约）

阅读器桌面应用（Electron 计划中）的高保真交互原型。纯 vanilla HTML/CSS/JS，无构建、无框架、无外部 JS 库。直接 `file://` 打开 `design/index.html` 运行。

审美方向：**E-Ink / Paper × 中文书卷气**。纸色暖底、墨色文字、朱砂印章红点缀、SVG 噪点纸纹、锐利克制动效（160ms，无弹跳）。禁止：渐变紫、emoji 图标、大圆角卡片、阴影堆叠、Inter/Roboto。

## 文件与职责

| 文件 | 负责 agent | 内容 |
|---|---|---|
| `design/index.html` | A | 静态骨架：titlebar、sidebar、4 个 view 壳、设置弹层、TOC 抽屉、toast 容器；引 Google Fonts、styles.css、app.js |
| `design/styles.css` | B | 全部样式：3 套主题 token、噪点纸纹、组件、动效、focus-visible、reduced-motion |
| `design/app.js` | C | 全部交互：数据、渲染书架/订阅列表/阅读器、视图路由、主题/字号/行距、拉取模拟、toast |

**唯一真源**：所有 id / class / data 属性以本 SPEC「DOM 契约」为准。HTML 静态骨架中的动态区域留空容器，由 JS 渲染。

## 设计 Token（B 实现，C 仅引用不定义）

```css
:root { /* 间距 4/8/12/16/24/32/48/64; --t: 160ms cubic-bezier(.25,0,0,1) */
  --font-ui: 'Noto Sans SC', sans-serif;
  --font-serif: 'Noto Serif SC', serif;
  --font-latin: 'Fraunces', serif; }
[data-theme="paper"] { --bg:#F5EFE3; --surface:#FCF9F1; --surface-2:#F1EAD9;
  --ink:#211B12; --ink-2:#5A5040; --muted:#8D8069; --line:#E0D6C2; --line-strong:#C9BCA2;
  --seal:#B5402A; --seal-ink:#8F2F1D; --seal-soft:rgba(181,64,42,.12); --kraft:#C4A77D; }
[data-theme="sepia"] { --bg:#EAD9B8; --surface:#F4E8CE; --surface-2:#E9DABD;
  --ink:#4A3823; --ink-2:#6B573C; --muted:#96835F; --line:#D8C39C; --line-strong:#C2A87A;
  --seal:#A2401F; --seal-ink:#7E3015; --seal-soft:rgba(162,64,31,.12); --kraft:#B08F5E; }
[data-theme="ink"] { --bg:#151210; --surface:#1E1A16; --surface-2:#26211B;
  --ink:#EAE2D0; --ink-2:#C4B8A0; --muted:#8B8070; --line:#332D24; --line-strong:#463E30;
  --seal:#E06A45; --seal-ink:#F08A63; --seal-soft:rgba(224,106,69,.14); --kraft:#9A7E56; }
```

- 封面色板（cover-0..4）：`#221D17` 墨、`#B5402A` 朱、`#44523F` 苔、`#33424E` 黛、`#7A5C3E` 驼。封面文字色：0 用 `#EDE4D2`，其余用 `#FBF6EA`。
- 圆角：卡片 2px、按钮 2px、swatch 圆形除外。阴影仅一层柔和 `0 8px 24px -12px rgba(33,27,18,.18)`。
- 噪点：`body::after` fixed 全屏，内联 SVG feTurbulence data-URI，opacity .05，pointer-events:none，z-index 500（toast 层 1000 之上不可盖）。
- `@media (prefers-reduced-motion: reduce)` 全部 transition/animation 置 none。

## 应用骨架（A 实现；C 按此查找节点）

```
html[data-theme="paper"] > body[data-view="shelf"]
.app (grid rows: 44px 1fr; height 100vh)
├─ header.titlebar
│  ├─ .brand  (.seal-mark「墨」24px 朱底纸字 + .brand-name 墨纸 serif700 + .brand-latin "Mozhi Reader" Fraunces italic muted)
│  └─ .win-ctrl  3 个装饰按钮 .win-btn（— ▢ ✕ 用 SVG），点击无行为只 hover
└─ .app-body (grid cols: 200px 1fr)
   ├─ nav.sidebar
   │  ├─ .nav-item[data-view="shelf|sources|settings"]（SVG 图标 + 文字；.active 时 seal-soft 底 + 左 2px seal 条）
   │  │    书架项内含 #nav-unread 徽标（seal 底纸字，min-width 18px 圆角 9px，内容如 5）
   │  └─ .side-foot  #side-sync 文本「上次同步 14:32」muted 12px
   ├─ main#view-shelf.view.is-active
   │  ├─ .view-head：.eyebrow「LIBRARY · 藏书」+ h1 书架 + .head-actions
   │  │    #shelf-tabs（.tab[data-filter="all|book|article"]，下划线式选中）+ button#btn-pull-all.primary「立即拉取全部」
   │  ├─ #shelf-stats（JS 填）muted 13px
   │  └─ #shelf-grid（JS 渲染卡片）
   ├─ main#view-reader.view（默认 .view 无 is-active 即隐藏；open 时 JS 加 is-active 且 body[data-view="reader"]）
   │  ├─ .reader-top：button#btn-reader-back（← SVG + 返回）｜.reader-title-box（#reader-title serif600 + #reader-chapter muted 13px）
   │  │   ｜#reader-progress-text（tabular-nums）+ button#btn-reader-toc（目录 SVG）+ button#btn-reader-settings（Aa serif）
   │  ├─ #reader-progress-bar（2px seal，宽度 = 进度%）
   │  ├─ #reader-scroll（overflow:auto 滚动容器；内含 #reader-content 阅读栏 max-width 640px 居中）
   │  ├─ #reader-toc（左抽屉，.open 时滑入；JS 填 .toc-item 列表）
   │  └─ #reader-settings（右上弹层 .open 显示；含 .theme-swatch[data-theme=paper|sepia|ink]×3 皆带 title、
   │      #font-minus #font-val #font-plus、.lh-opt[data-lh="1.7|1.9|2.1"]×3）
   ├─ main#view-sources.view
   │  ├─ .view-head：eyebrow「SUBSCRIPTIONS · 订阅」+ h1 订阅源 + button#btn-add-source.primary「添加订阅」
   │  ├─ #source-form（默认 .hidden；字段 #sf-name #sf-url、select#sf-type(RSS/网页/API) #sf-interval、#sf-save.primary #sf-cancel.ghost）
   │  └─ #source-list（JS 渲染 .source-row）
   ├─ main#view-settings.view
   │  └─ #settings-rows（A 直接静态写：6 行 .setting-row，含 .setting-switch[data-key] 开关、select、路径 + 「打开文件夹」ghost、清空缓存 .danger ghost）
   └─ （每 view 自身可滚动，padding 32px 40px）
#toasts（fixed right-24 bottom-24，z-index 1000；JS 填 .toast）
```

### 动态渲染契约（C 生成、B 样式化）

书架卡片（#shelf-grid 内）：
```html
<article class="card book" data-id tabindex="0">        <!-- article 用 .card.article -->
  <div class="cover cover-i">                            <!-- i=0..4 封面色 -->
    <span class="cover-title">朝花夕拾</span>             <!-- book: vertical-rl 竖排 -->
    <span class="cover-author">鲁迅</span>                <!-- book only，竖排小字 -->
    <span class="cover-fmt">EPUB</span>                   <!-- book only，左下角 11px -->
    <span class="dot"></span>                             <!-- article 未读小圆点 8px seal -->
    <span class="cover-src">科技爱好者周刊</span>          <!-- article only，Fraunces italic -->
  </div>
  <h3 class="card-title">朝花夕拾</h3>
  <p class="card-meta">鲁迅 · 已读 62%</p>                <!-- article: 来源 · 11-08 -->
  <div class="progress"><i style="width:62%"></i></div>   <!-- 0% 时隐藏 -->
</article>
```
新文章入场：`.card.is-new` 淡入上移动画 + seal 描边脉冲一次。

订阅行（#source-list 内）：
```html
<div class="source-row" data-id>
  <span class="src-icon rss|web|api"></span>             <!-- SVG -->
  <div class="src-main"><div class="src-name">科技爱好者周刊</div><div class="src-url">rsshub.app/ruanyifeng</div></div>
  <select class="src-interval">15分钟/30分钟/1小时/6小时/12小时/每天/仅手动</select>
  <span class="src-status">上次 2 小时前 · +3</span>       <!-- 拉取中: .loading + 正在拉取…; 完成: <b class="ok">✓ 刚刚</b> · +2 -->
  <button class="switch on" data-id aria-label="启用开关"><i></i></button>
  <button class="btn ghost btn-pull" data-id>立即拉取</button>
</div>
```

toast：`<div class="toast"><svg/><div><b>标题</b><span>副文</span></div></div>`

## 交互行为（C 实现，全部必须）

1. 视图路由：点 .nav-item → body[data-view] + 目标 view 加 .is-active（其余移除）；reader 打开时同样机制。切 view 无动画或 120ms 淡入。
2. 打开阅读：点/回车 .card → 填充 #reader-title/#reader-chapter/#reader-content（书=完整《匆匆》正文模板；文章=短文模板）→ 切到 reader → #reader-scroll 滚到该书保存的 offset（进度% × 内容高度）。
3. 阅读进度：#reader-scroll 滚动（rAF 节流）→ 更新 #reader-progress-text（整数%）与 #reader-progress-bar 宽度；返回时把 % 写回对应书的 progress 并 toast「已保存阅读进度 · {title} {p}%」，书架卡片进度条即时更新。
4. 主题切换：.theme-swatch 点击 → document.documentElement.dataset.theme 变更 + swatch 选中态；设置页 select 同步。默认 paper。
5. 字号：#font-minus/#font-plus 步进 1px，范围 14–22，写 #font-val 与 CSS 变量 --read-size（挂 :root）；行距 .lh-opt 写 --read-lh。阅读正文样式：font-family serif、font-size var(--read-size,17px)、line-height var(--read-lh,1.9)、段首 text-indent 2em、段落间距 .5em。
6. 书架筛选：.tab 切换 .active，#shelf-grid 按 data-filter 过滤 book/article/all（display 重渲染）；#shelf-stats 文案随数据更新。
7. 手动拉取（单源）：.btn-pull 点击 → 该行 .src-status 换「正在拉取…」+ 图标旋转 → 1400ms 后「✓ 刚刚 · +2」→ toast「{name} · 新增 2 篇」→ 未读徽标 #nav-unread +2、#shelf-stats 未读 +2、向 books 数据 prepend 2 篇新文章卡（is-new），当前在订阅页则返回书架可见。
8. 拉取全部：#btn-pull-all → 依次（间隔 300ms）触发各启用源拉取动画 → 全部完成 toast「拉取完成 · 共新增 N 篇」。
9. 开关：.switch 点击切 .on；订阅行关闭 → 整行 .disabled（opacity .55 + 名称后缀「已暂停」）；设置页开关切换即时生效 + 可 toast。
10. 添加订阅：#btn-add-source 展开/收起 #source-form；#sf-save 校验 name/url 非空（空则输入框 .error 红描边 + 抖动一次）→ prepend 新 .source-row + toast「已添加订阅 · {name}」→ 收起表单清空。
11. TOC：#btn-reader-toc 切 #reader-toc.open；.toc-item 点击 → 高亮 .current + #reader-scroll 滚到对应 section（文章可滚顶）+ 关抽屉。
12. 图标一律内联 SVG（线性 1.5px stroke，20px，Phosphor 风格）：books/rss/gear/arrow-left/list/refresh/plus/minus/check/globe/api/window 控件。禁止 emoji。

## 种子数据（C）

books：朝花夕拾·鲁迅·EPUB·cover1·62%；呐喊·鲁迅·EPUB·cover0·0%；城南旧事·林海音·PDF·cover2·34%；世说新语·EPUB·cover3·0%；唐诗三百首·TXT·cover4·18%；浮生六记·沈复·EPUB·cover2·100%。
articles（初始未读 5）：「第 305 期：AI 与阅读的未来」科技爱好者周刊·11-10·未读；「把 RSS 作为一种生活方式」阮一峰周刊·11-09·未读；「为什么我还在写博客」少数派·11-09·未读；「本地优先软件的十年」科技爱好者周刊·11-08·未读·已读38%；「从纸到屏：阅读介质小史」少数派·11-07·已读100%；「PDF 重排版的一次尝试」阮一峰周刊·11-06·已读100%。
sources：科技爱好者周刊·rsshub.app/ruanyifeng·RSS·6小时·上次 2 小时前 +3·开；阮一峰周刊·ruanyifeng.com·RSS·1小时·上次 40 分钟前 +1·开；少数派·sspai.com·RSS·30分钟·上次 25 分钟前 +0·开；某独立博客·blog.example.com·网页·仅手动·上次 3 天前 +2·关。

阅读正文（书模板）：朱自清《匆匆》全文 5 段 + pull-quote（燕子去了，有再来的时候…）+ 花边分隔符；TOC 一~五章对应段落分组。文章模板：标题 + 来源日期行 + 3 段通用短文（内容围绕该文标题自拟 2-3 句/段即可）。

## 质量底线（B/C 共同）

- focus-visible：2px seal 外描边 offset 2px；按钮/卡片 cursor pointer；触达区 ≥ 32px（桌面）。
- 对比度：正文 --ink/--bg ≥ 7:1；muted 仅用于次要文字 ≥ 4.5:1；seal 作文字时 ≥ 4.5:1。
- 空状态：筛选无结果时 #shelf-grid 显示居中 muted 文案「这里还没有内容」。
- 窗口基准 1280×800，最小可用 1024×680；书架栅格 `repeat(auto-fill,minmax(168px,1fr))`。
