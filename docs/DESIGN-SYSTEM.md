# 墨纸设计规范（DESIGN-SYSTEM）

> 单一真源。**后续所有 UI 优化、新组件、重构都必须遵循本规范**；规范本身的变化先改这份文档、再改代码。
> 桌面端实现于 `packages/desktop/src/renderer/src/styles.css`（token 定义在其 `:root`）；移动端 `packages/mobile` 遵循同一套数值与命名哲学。

---

## 0. 设计基调

E-Ink / Paper × 中文书卷气：纸底、墨字、朱砂点缀；锐利、少弹跳、重排印。任何新样式先问「纸上的排印会怎么做」。

## 1. 间距刻度（必须用 token）

| Token | 值 | 用途 |
|---|---|---|
| `--sp-1` | 4px | 微间距：图标与文字旁的呼吸、卡片内细缝 |
| `--sp-2` | 8px | 紧凑间隙：同组元素间 |
| `--sp-3` | 12px | 常规间隙：列表行内边距、小卡边距 |
| `--sp-4` | 16px | 标准间隙：区块间距、网格列距 |
| `--sp-5` | 24px | 区块节奏：view-head 与内容、大卡片内边距、网格行距 |
| `--sp-6` | 32px | 页面顶部留白（view padding-top） |
| `--sp-7` | 48px | 页面左右留白（view padding-x）、浮层避让 |
| `--sp-8` | 64px | 特大留白（罕用） |

**规则**
- 布局级间距（区块 margin/padding、flex/grid gap）**只用** `--sp-*` token。
- 控件内部度量（按钮内边距、徽标尺寸等）允许用 §6 的固定控件度量，不算违规。
- 禁止出现 token 与固定值之外的「魔法数」间距；确需新档位时先在 `:root` 扩 token 并更新本表。

## 2. 布局骨架

```
.app（flex 行）
├─ .sidebar  200px ↔ 收起 64px（transition .22s）
└─ .main > .view  padding: 32px 48px 24px（--sp-6/7/5），独立滚动
```

- **视图头部** `.view-head`：eyebrow（拉丁小字 seal 色 .32em）→ `h1`（衬线 30px）→ `.stats`（12.5px muted）；距下方内容 `--sp-5`。
- **内容宽度上限**（居中或左对齐皆可，但不得超）：
  - 阅读正文 `.reader-page` / PDF 导航：**720px**
  - 设置 `.settings-groups`：**640px**
  - 独占表单卡：**860px**
  - 书源页双栏 `grid-template-columns: minmax(320px, 400px) minmax(0, 1fr)`，gap `--sp-4`；≤1120px 退化单栏
  - 书架网格 `repeat(auto-fill, minmax(190px, 1fr))`，gap `--sp-5 --sp-4`
- **卡片双规格**：表单/设置卡 padding `--sp-5`；列表卡（同步记录、目录等）padding `14px 16px`。
- **断点**：1120px（书源双栏退化）。网格类一律 auto-fill 自适应，不新增断点。

## 3. 字号阶梯（UI 无级缩放以外的唯一来源）

| 档 | 值 | 用途 |
|---|---|---|
| 特大 | 30px | 视图 h1（衬线 700，.06em） |
| 大 | 26px | 品牌「墨纸」（衬线 700，.35em） |
| 中 | 16.5px | 文章卡标题（衬线） |
| 正文 | 14px | body、卡标题（600） |
| 次正文 | 13.5px | 导航项、阅读器书名 |
| 控件 | 13px | 按钮、tab、输入框 |
| 辅助 | 12.5px | stats、meta、article-meta |
| 提示 | 12px | form-hint、时间戳 |
| 小字 | 11.5px | sf-label、art-src |
| 拉丁 | 11px | eyebrow、brand-latin |

阅读器正文字号/行距是用户设置（14–24px / 1.7|1.9|2.2），走 `--read-size`/`--read-lh`，不在此阶梯内。

## 4. 圆角与描边

| 档 | 值 | 用途 |
|---|---|---|
| `--r` | 2px | 输入框、按钮、tab、封面（**默认控件圆角**） |
| 小 | 4px | 迷你列表项、代码块 |
| 中 | 6px | 卡片、下拉菜单、开关钮 |
| 大 | 8px | 大卡（同步记录）、抽屉、徽标（半高） |
| 圆 | 50% / 999px | 圆点、头像、滑轨 |

描边：常规 `--line`，强调 `--line-strong`，宽度一律 1px（侧栏 nav 激活态的 2px 印记线除外）。虚线只用于「分隔线/历史弱化」语义。

## 5. 色彩与动效

- 色彩只用主题 token（`--bg/--surface/--surface-2/--ink/--ink-2/--muted/--line/--line-strong/--seal/--seal-ink/--seal-soft/--seal-fg/--kraft`），四主题已对齐；**禁止硬编码色值**（错误红 `#b3261e` 是唯一例外，语义为「校验错误」）。
- 动效：默认时长 `--t`（160ms）+ `--ease`；进出场/抽屉 220ms；loading 旋转 800ms 线性。位移类动效幅度 ≤2px（按压下沉 1px、卡片悬浮 -2px）。
- `prefers-reduced-motion: reduce` 时关闭所有非透明度动画（既有惯例，新增动效必须带对应 reduce 分支）。

## 6. 控件度量（固定，不随 token 缩放）

> 2026-11-25 起，按钮与分段控件采用 iOS 风胶囊规范（用户 m11469 指定）。

| 控件 | 度量 |
|---|---|
| `.btn` | 高 32px，padding 0 16px，全圆角胶囊（`--r-full`），图标与文字 gap 7px（inline-flex 居中），字重 500；主=seal 填充，次=surface-2 填充（无描边） |
| `.btn.sm` | 高 26px，padding 0 12px |
| `.seg` 分段控件 | 灰轨胶囊：surface-2 底 + padding 2px + gap 2px；选中=浮起药丸（surface 底 + 微阴影），无分隔线 |
| `.tab` | padding 6px 16px |
| `.sf-input` | padding 8px 10px，高 ≈33px（与表单行对齐） |
| 列表行（目录/书源行） | padding 7px 10px |
| `.nav-item` | padding 9px 12px；图标与文字 gap 12px |
| 徽标 | 18×18（收起态 15×15） |
| 开关 `.slider-switch` | 40×22，knob 18px，位移 18px |
| 图标钮（nav-toggle/⋯） | 30×30 |
| 视图头行 `.view-head-row` | 标题块左、动作组右（flex space-between、align-items flex-end、动作组 gap sp-2）；≤1120px 纵排 |
| 命中目标 | 任何可点元素 ≥30×30；触控语义场景 ≥44px |

## 7. 层级（z-index 阶梯）

`2` 卡内浮层 → `3` 卡角标 → `30` 下拉/弹层菜单 → `40` 确认层（面板 41）→ `90` 抽屉遮罩 → `110` toast → `120` 拖放遮罩。新浮层按语义入梯，禁止插中间值。

## 8. 评审清单（合入前过一遍）

- [ ] 间距全部来自 `--sp-*` 或 §6 控件度量？
- [ ] 字号落在 §3 阶梯？色彩全 token（除 `#b3261e`）？
- [ ] 圆角/描边按 §4？z-index 入梯？
- [ ] 动效 ≤220ms 且带 reduced-motion 分支？
- [ ] 新容器宽度 ≤ §2 上限？新断点真的必要吗？
- [ ] 图标用 SVG 内联（Phosphor 风格线条），无 emoji？
- [ ] 键盘可达：focus-visible 可见、Enter 触发、Esc 关闭浮层？

## 9. 移动端（packages/mobile）——iOS 式布局规范

> 2026-11-25 用户指定「参照 iOS 最新版设计」重构移动端整体布局。核心=Apple Native Experience 骨架 × 墨纸排印皮肤。

### 9.1 导航结构

- **底部标签栏**（`src/app/(tabs)/_layout.tsx` 自绘 TabBar）：
  - 三项：书架 / 历史 / 设置；图标=单字印章（书/历/设，serif 20px），标签 10px letterSpacing 1；
  - 激活态=seal 色（图标+标签同色），非激活=muted、opacity .82；
  - bar 高度 ≥48 + 底部安全区 padding（`useSafeAreaInsets().bottom`）；背景 `t.surface`、顶部 1px 发丝线 `t.line`；
  - `accessibilityRole="tab"` + `aria-label` + `accessibilityState.selected`（注意：RNW 不落 aria-selected 到 DOM 属性，验证选中态看颜色）；
  - 阅读器（`/book/[id]`）与配对页（`/pair`）在 Tabs 之外推入——整屏、标签栏自动隐藏。
- **屏头**：eyebrow（拉丁 11px seal）→ 大标题（serif 26/600）→ stats（12px muted）；`paddingHorizontal 20, paddingTop 18`。
  屏内不再放返回箭头/顶部链接——导航职责全部归标签栏（深链返回除外）。
- 滚动内容 `paddingBottom 32`（Attached bar 模式，内容不经 bar 底下穿过）。

### 9.2 控件与触控

- 触控目标 ≥48×48（bar 项、按钮、行）；列表行 paddingVertical ≥10；
- 胶囊按钮/确认卡/分组列表沿用桌面 §6 的 iOS 胶囊度量（btn 高 32、`border-radius 999`）；
- 单字印章图标（书/历/设/墨）是墨纸的既定图标语言，不算 emoji 违例；新增图标优先 SVG 线条，确无必要时才用单字印。

### 9.3 禁止

- 顶部散落文字链接当导航；屏内返回箭头（Tabs 场景）；
- 标签栏覆盖在滚动内容之上而不给内容留底部 padding；
- 图标用 emoji；选中态只靠透明度不用颜色。
