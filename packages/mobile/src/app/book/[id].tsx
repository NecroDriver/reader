import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LH_CHOICES, MAX_SIZE, MIN_SIZE, usePrefs } from '../../theme'
import { getBook, getChapter, getSetting, getToc, saveProgress, setSetting } from '../../db'
import { THEMES, type TocRow } from '../../types'

/* 目录分页：一章一行渲染成本 ≈37px；千章书全量渲染必卡，
   每次只挂 PAGE 行，滚动近底自动追加；打开时窗口直接落在当前章。 */
const PAGE = 150
const ROW_EST = 37

export default function Reader(): React.JSX.Element | null {
  const { id } = useLocalSearchParams<{ id: string }>()
  const bookId = Number(id)
  const db = useSQLiteContext()
  const insets = useSafeAreaInsets()
  const { theme, setTheme, size, setSize, lh, setLh } = usePrefs()
  const t = THEMES[theme]

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [toc, setToc] = useState<TocRow[]>([])
  const [chIdx, setChIdx] = useState(0)
  const [chTitle, setChTitle] = useState('')
  const [paras, setParas] = useState<string[]>([])
  const [pct, setPct] = useState(0)
  const [pop, setPop] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  /* 目录：倒序开关（持久 settings 表）+ 已渲染窗口 [tocStart, tocStart+tocLimit) */
  const [tocDesc, setTocDesc] = useState(false)
  const [tocStart, setTocStart] = useState(0)
  const [tocLimit, setTocLimit] = useState(PAGE)

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const tocScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const last = useRef({ idx: 0, pct: 0, label: '' })
  /* 章节即时值：onScroll 的闭包会滞后于 goChapter 的 setChIdx，
     scrollTo(0) 触发的迟到滚动事件若用旧闭包会把上一章写回进度表 */
  const chRef = useRef({ idx: 0, title: '' })
  const pendingSave = useRef(false)
  const restoredFor = useRef<number | null>(null)
  const initialPct = useRef<number | null>(null)

  const flush = useCallback(
    (idx: number, p: number, label: string): void => {
      last.current = { idx, pct: p, label }
      pendingSave.current = false
      void saveProgress(db, bookId, idx, p, label)
    },
    [db, bookId]
  )

  const note = useCallback(
    (idx: number, p: number, label: string): void => {
      last.current = { idx, pct: p, label }
      pendingSave.current = true
    },
    []
  )

  /* 打开书：读元数据 + 恢复章节 + 读目录排序偏好 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const b = await getBook(db, bookId)
      if (!b || !alive) return
      setTitle(b.title)
      setAuthor(b.author)
      const rows = await getToc(db, bookId)
      if (!alive) return
      setToc(rows)
      const start = Math.min(Math.max(b.current_chapter, 0), Math.max(rows.length - 1, 0))
      initialPct.current = b.progress > 0 ? b.progress : null
      chRef.current = { idx: start, title: b.chapter_label }
      setChIdx(start)
      note(start, b.progress, b.chapter_label)
      const d = await getSetting(db, 'toc_desc')
      if (alive && d === '1') setTocDesc(true)
    })()
    return () => {
      alive = false
    }
  }, [db, bookId, note])

  /* 退出兜底：把未落库的进度写回 */
  useEffect(() => {
    return () => {
      if (pendingSave.current) flush(last.current.idx, last.current.pct, last.current.label)
    }
  }, [flush])

  const goChapter = useCallback(
    (idx: number): void => {
      if (idx < 0 || idx >= toc.length) return
      restoredFor.current = null
      initialPct.current = 0
      const label = toc[idx]?.title ?? ''
      chRef.current = { idx, title: label }
      setChIdx(idx)
      note(idx, 0, label)
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    },
    [toc, note]
  )

  /* 载入章节正文 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const row = toc.length > 0 ? await getChapter(db, bookId, chIdx) : null
      if (!alive) return
      chRef.current = { idx: chIdx, title: row?.title ?? '' }
      setChTitle(row?.title ?? '')
      setParas((row?.content ?? '').split('\n').filter((p) => p.trim().length > 0))
    })()
    return () => {
      alive = false
    }
  }, [db, bookId, chIdx, toc.length])

  /* 章内滚动 → 进度（节流 800ms 落库；章节取即时 ref，防迟到事件串章） */
  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }): void => {
      const { y } = e.nativeEvent.contentOffset
      const max = Math.max(1, e.nativeEvent.contentSize.height - e.nativeEvent.layoutMeasurement.height)
      const p = Math.min(100, Math.max(0, Math.round((y / max) * 100)))
      setPct(p)
      note(chRef.current.idx, p, chRef.current.title)
    },
    [note]
  )

  useEffect(() => {
    const h = setTimeout(() => {
      if (pendingSave.current) flush(last.current.idx, last.current.pct, last.current.label)
    }, 800)
    return () => clearTimeout(h)
  }, [pct, flush])

  /* 目录展示序：倒序时整表反转（useMemo 须在早退 return 之前调用） */
  const ordered = useMemo(
    () => (tocDesc ? [...toc].reverse() : toc),
    [toc, tocDesc]
  )

  if (!id) return null

  /* ---------- 目录展示：排序 + 分页窗口（focusRow 等在渲染体中定义） ---------- */
  const rendered = ordered.slice(tocStart, tocStart + tocLimit)
  /* 当前章在展示序中的行号（倒序时从尾数） */
  const curRow = tocDesc ? toc.length - 1 - chIdx : chIdx

  /* 窗口平移到含 row ± 缓冲（前 40 后 110），并滚过去 */
  const focusRow = (row: number): void => {
    setTocStart(Math.max(0, row - 40))
    setTocLimit(PAGE)
    setTimeout(() => {
      tocScrollRef.current?.scrollTo({ y: Math.max(0, (row - Math.max(0, row - 40)) * ROW_EST - 40), animated: false })
    }, 60)
  }

  const openToc = (): void => {
    setTocOpen(true)
    focusRow(curRow)
  }

  const toggleTocDesc = (): void => {
    const nd = !tocDesc
    setTocDesc(nd)
    void setSetting(db, 'toc_desc', nd ? '1' : '0')
    setTocStart(0)
    setTocLimit(PAGE)
    focusRow(nd ? toc.length - 1 - chIdx : chIdx)
  }

  const onTocScroll = (e: {
    nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } }
  }): void => {
    /* 近底自动向下扩一页，免手动点 */
    const { y } = e.nativeEvent.contentOffset
    const max = e.nativeEvent.contentSize.height - e.nativeEvent.layoutMeasurement.height
    if (max - y < 600 && tocStart + tocLimit < ordered.length) {
      setTocLimit((l) => Math.min(ordered.length - tocStart, l + PAGE))
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 顶栏 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: t.line,
          gap: 8
        }}
      >
        <Pressable accessibilityLabel="返回书架" onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: t.seal, fontSize: 15 }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11 }}>
            {author} · {chIdx + 1}/{toc.length} · {pct}%
          </Text>
        </View>
        <Pressable accessibilityLabel="目录" onPress={openToc} hitSlop={8}>
          <Text style={{ color: t.ink2, fontSize: 13 }}>目录</Text>
        </Pressable>
        <Pressable accessibilityLabel="排版" onPress={() => setPop((v) => !v)} hitSlop={8}>
          <Text style={{ color: t.ink2, fontSize: 15 }}>Aa</Text>
        </Pressable>
      </View>

      {/* 正文 */}
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={120}
        contentContainerStyle={{ paddingHorizontal: 22, paddingVertical: 24 }}
        onContentSizeChange={() => {
          /* 进度恢复：章内容定型且本章未恢复过时滚到比例位置 */
          if (restoredFor.current === chIdx) return
          restoredFor.current = chIdx
          const p = initialPct.current
          if (p !== null && p > 0) {
            scrollRef.current?.scrollTo({ y: 0, animated: false })
          }
        }}
      >
        <Text
          style={{
            color: t.ink,
            fontSize: 20,
            fontWeight: '600',
            textAlign: 'center',
            marginBottom: 22
          }}
        >
          {chTitle}
        </Text>
        {paras.map((p, i) => (
          <Text
            key={i}
            style={{
              color: t.ink,
              fontSize: size,
              lineHeight: Math.round(size * lh),
              marginBottom: size * 0.9,
              textAlign: 'justify'
            }}
          >
            {p}
          </Text>
        ))}
        {/* 章末导航 */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTopWidth: 1,
            borderTopColor: t.line,
            marginTop: 16,
            paddingTop: 14,
            paddingBottom: 8
          }}
        >
          <Pressable
            disabled={chIdx <= 0}
            onPress={() => goChapter(chIdx - 1)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, opacity: chIdx <= 0 ? 0.35 : 1 }}
          >
            <Text style={{ color: t.seal, fontSize: 14 }}>上一章</Text>
          </Pressable>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {chIdx + 1} / {toc.length}
          </Text>
          <Pressable
            disabled={chIdx >= toc.length - 1}
            onPress={() => goChapter(chIdx + 1)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, opacity: chIdx >= toc.length - 1 ? 0.35 : 1 }}
          >
            <Text style={{ color: t.seal, fontSize: 14 }}>下一章</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* 排版弹层：点击面板外任意处关闭 */}
      {pop ? (
        <>
          <Pressable
            accessibilityLabel="关闭排版面板"
            onPress={() => setPop(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            style={{
              position: 'absolute',
              top: 48,
              right: 12,
              backgroundColor: t.surface,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.line,
              padding: 14,
              width: 230,
              gap: 12,
              elevation: 6
            }}
          >
          <Text style={{ color: t.muted, fontSize: 11, letterSpacing: 1 }}>主题</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((k) => (
              <Pressable
                key={k}
                accessibilityLabel={`主题 ${THEMES[k].label}`}
                onPress={() => setTheme(k)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: THEMES[k].bg,
                  borderWidth: theme === k ? 2 : 1,
                  borderColor: theme === k ? THEMES[k].seal : t.lineStrong,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ color: THEMES[k].ink, fontSize: 11 }}>{THEMES[k].label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: t.muted, fontSize: 11, letterSpacing: 1 }}>字号</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                accessibilityLabel="减小字号"
                onPress={() => setSize(size - 1)}
                disabled={size <= MIN_SIZE}
                style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: size <= MIN_SIZE ? 0.35 : 1 }}
              >
                <Text style={{ color: t.ink, fontSize: 16 }}>−</Text>
              </Pressable>
              <Text style={{ color: t.ink, fontSize: 14, minWidth: 26, textAlign: 'center' }}>{size}</Text>
              <Pressable
                accessibilityLabel="增大字号"
                onPress={() => setSize(size + 1)}
                disabled={size >= MAX_SIZE}
                style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: size >= MAX_SIZE ? 0.35 : 1 }}
              >
                <Text style={{ color: t.ink, fontSize: 16 }}>＋</Text>
              </Pressable>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: t.muted, fontSize: 11, letterSpacing: 1 }}>行距</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {LH_CHOICES.map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setLh(v)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 6,
                    backgroundColor: lh === v ? t.sealSoft : 'transparent',
                    borderWidth: 1,
                    borderColor: lh === v ? t.seal : t.line
                  }}
                >
                  <Text style={{ color: lh === v ? t.seal : t.ink2, fontSize: 12 }}>{v}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          </View>
        </>
      ) : null}

      {/* 目录抽屉（对标竞品）：宽面板 + 安全区头部（书名/作者/关闭）+ 工具行 + 章节行带字数 */}
      <Modal visible={tocOpen} animationType="slide" transparent onRequestClose={() => setTocOpen(false)}>
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityLabel="关闭目录"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.35)' }}
            onPress={() => setTocOpen(false)}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: '92%',
              backgroundColor: t.surface,
              paddingLeft: 16,
              paddingRight: 12
            }}
          >
            {/* 头部块：避开状态栏（web 无安全区时保底留白，两端都不贴顶），书名 + 作者 + 关闭 */}
            <View
              style={{
                paddingTop: Math.max(insets.top, 16) + 8,
                paddingBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10
              }}
            >
              <View style={{ flex: 1, minHeight: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ color: t.ink, fontSize: 17, fontWeight: '600', fontFamily: 'serif' }}
                >
                  {title || '目录'}
                </Text>
                {author ? (
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 3 }}>{author} 著</Text>
                ) : null}
              </View>
              <Pressable
                accessibilityLabel="关闭目录"
                onPress={() => setTocOpen(false)}
                hitSlop={8}
                style={{
                  width: 30,
                  height: 30,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  backgroundColor: t.surface2
                }}
              >
                <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 18 }}>✕</Text>
              </Pressable>
            </View>

            {/* 工具行：统计 + 正序/倒序 */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8
              }}
            >
              <Text style={{ color: t.muted, fontSize: 11, letterSpacing: 2 }}>
                目录 · {toc.length} 章
                {tocStart + tocLimit < ordered.length || tocStart > 0
                  ? ` · 显示 ${tocStart + 1}-${tocStart + rendered.length}`
                  : ''}
              </Text>
              <Pressable
                accessibilityLabel={tocDesc ? '切换为正序排列' : '切换为倒序排列'}
                onPress={toggleTocDesc}
                hitSlop={8}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: tocDesc ? t.sealSoft : 'transparent',
                  borderWidth: 1,
                  borderColor: tocDesc ? t.seal : t.line
                }}
              >
                <Text style={{ color: tocDesc ? t.seal : t.ink2, fontSize: 11.5, fontWeight: '600' }}>
                  {tocDesc ? '倒序' : '正序'}
                </Text>
                <Text style={{ color: tocDesc ? t.seal : t.ink2, fontSize: 11 }}>
                  {tocDesc ? '↑' : '↓'}
                </Text>
              </Pressable>
            </View>

            {(curRow < tocStart || curRow >= tocStart + tocLimit) && toc.length > PAGE && (
              <Pressable
                accessibilityLabel="跳到正在读"
                onPress={() => focusRow(curRow)}
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: t.sealSoft,
                  marginBottom: 6
                }}
              >
                <Text style={{ color: t.seal, fontSize: 12 }}>
                  跳到正在读 · {(toc[chIdx]?.title ?? '').slice(0, 10)}
                </Text>
              </Pressable>
            )}

            <ScrollView
              ref={tocScrollRef}
              onScroll={onTocScroll}
              scrollEventThrottle={200}
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            >
              {tocStart > 0 && (
                <Pressable
                  accessibilityLabel="加载前面章节"
                  onPress={() => {
                    const before = tocStart
                    setTocStart(Math.max(0, tocStart - PAGE))
                    if (before - PAGE < 0) setTocLimit((l) => l + before)
                    setTimeout(() => {
                      tocScrollRef.current?.scrollTo({ y: 0, animated: false })
                    }, 60)
                  }}
                  style={{
                    alignItems: 'center',
                    paddingVertical: 10,
                    marginBottom: 6,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: t.line
                  }}
                >
                  <Text style={{ color: t.ink2, fontSize: 12.5 }}>
                    ↑ 加载前面（还有 {tocStart} 章）
                  </Text>
                </Pressable>
              )}
              {rendered.map((c) => (
                <Pressable
                  key={c.idx}
                  onPress={() => {
                    setTocOpen(false)
                    goChapter(c.idx)
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 10,
                    paddingHorizontal: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: t.line,
                    backgroundColor: c.idx === chIdx ? t.sealSoft : 'transparent',
                    borderRadius: 4
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      color: c.idx === chIdx ? t.seal : t.ink2,
                      fontSize: 13,
                      fontWeight: c.idx === chIdx ? '600' : '400'
                    }}
                  >
                    {c.title}
                  </Text>
                  {typeof c.chars === 'number' && c.chars > 0 ? (
                    <Text style={{ color: t.muted, fontSize: 10.5, fontVariant: ['tabular-nums'] }}>
                      {c.chars.toLocaleString()}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {tocStart + tocLimit < ordered.length && (
                <Pressable
                  accessibilityLabel="加载更多章节"
                  onPress={() => setTocLimit((l) => Math.min(ordered.length - tocStart, l + PAGE))}
                  style={{
                    alignItems: 'center',
                    paddingVertical: 12,
                    marginVertical: 6,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: t.line
                  }}
                >
                  <Text style={{ color: t.ink2, fontSize: 12.5 }}>
                    加载更多（还剩 {ordered.length - tocStart - rendered.length} 章）
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}
