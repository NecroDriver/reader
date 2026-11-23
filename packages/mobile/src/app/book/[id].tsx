import { useCallback, useEffect, useRef, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { LH_CHOICES, MAX_SIZE, MIN_SIZE, usePrefs } from '../../theme'
import { getBook, getChapter, getToc, saveProgress } from '../../db'
import { THEMES, type TocRow } from '../../types'

export default function Reader(): React.JSX.Element | null {
  const { id } = useLocalSearchParams<{ id: string }>()
  const bookId = Number(id)
  const db = useSQLiteContext()
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

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
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

  /* 打开书：读元数据 + 恢复章节 */
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

  if (!id) return null

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
        <Pressable accessibilityLabel="目录" onPress={() => setTocOpen(true)} hitSlop={8}>
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

      {/* 排版弹层 */}
      {pop ? (
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
      ) : null}

      {/* 目录抽屉 */}
      <Modal visible={tocOpen} animationType="slide" transparent onRequestClose={() => setTocOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.35)' }} onPress={() => setTocOpen(false)}>
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: '78%',
              backgroundColor: t.surface,
              paddingVertical: 16,
              paddingHorizontal: 14
            }}
          >
            <Text style={{ color: t.muted, fontSize: 11, letterSpacing: 2, marginBottom: 10 }}>
              目录 · {toc.length} 章
            </Text>
            <ScrollView>
              {toc.map((c) => (
                <Pressable
                  key={c.idx}
                  onPress={() => {
                    setTocOpen(false)
                    goChapter(c.idx)
                  }}
                  style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.line }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: c.idx === chIdx ? t.seal : t.ink2,
                      fontSize: 13,
                      fontWeight: c.idx === chIdx ? '600' : '400'
                    }}
                  >
                    {c.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}
