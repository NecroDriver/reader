import { useCallback, useState } from 'react'
import { Image } from 'expo-image'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Link, useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { usePrefs } from '../../theme'
import { COVER_PALETTE, THEMES, type ThemeDef } from '../../types'
import { listHistory, type HistoryRow } from '../../db'

function fmtReadTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x: number): string => String(x).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= dayStart) return `今天 ${hm}`
  if (ts >= dayStart - 86400000) return `昨天 ${hm}`
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

interface Group {
  key: string
  label: string
  items: HistoryRow[]
}

function groupsOf(items: HistoryRow[]): Group[] {
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const gs: Group[] = [
    { key: 'today', label: '今天', items: [] },
    { key: 'yesterday', label: '昨天', items: [] },
    { key: 'earlier', label: '更早', items: [] }
  ]
  for (const h of items) {
    if (h.last_read_at >= dayStart) gs[0].items.push(h)
    else if (h.last_read_at >= dayStart - 86400000) gs[1].items.push(h)
    else gs[2].items.push(h)
  }
  return gs.filter((g) => g.items.length > 0)
}

export default function HistoryScreen(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]
  const [items, setItems] = useState<HistoryRow[] | null>(null)

  const reload = useCallback((): (() => void) => {
    let alive = true
    void (async () => {
      try {
        const rows = await listHistory(db)
        if (alive) setItems(rows)
      } finally {
        if (alive) setItems((v) => v ?? [])
      }
    })()
    return () => {
      alive = false
    }
  }, [db])

  /* 每次进入历史页重查：阅读器返回后时间序立即更新 */
  useFocusEffect(reload)

  const groups = items !== null ? groupsOf(items) : []

  const s = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: t.bg },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
    eyebrow: { color: t.seal, fontSize: 11, letterSpacing: 2 },
    title: { color: t.ink, fontSize: 26, fontWeight: '600', marginTop: 4, fontFamily: 'serif' },
    stats: { color: t.muted, fontSize: 12, marginTop: 2, marginBottom: 8 },
    groupLabel: { color: t.seal, fontSize: 11, letterSpacing: 2, marginTop: 18, marginBottom: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.line
    },
    /* 缩略封面：与书架同为 5:7，放大到 40×56 让真封面看得清 */
    cover: {
      width: 40,
      height: 56,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    coverChar: { color: '#F3EDE0', fontSize: 15, fontWeight: '600', fontFamily: 'serif' },
    info: { flex: 1, minWidth: 0 },
    rowTitle: { color: t.ink, fontSize: 15, fontWeight: '600', fontFamily: 'serif' },
    rowMeta: { color: t.muted, fontSize: 12, marginTop: 2 },
    time: { color: t.muted, fontSize: 12 },
    empty: { color: t.muted, textAlign: 'center', marginTop: 64, fontSize: 13 }
  })

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.scrollContent}>
      <Text style={s.eyebrow}>HISTORY · 足迹</Text>
      <Text style={s.title}>阅读历史</Text>
      <Text style={s.stats}>
        {items === null ? '读取中…' : `${items.length} 条 · 按最近阅读排序`}
      </Text>
      {groups.map((g) => (
        <View key={g.key}>
          <Text style={s.groupLabel}>{g.label}</Text>
          {g.items.map((h) => (
            <HistoryRowItem key={h.id} h={h} s={s} />
          ))}
        </View>
      ))}
      {items !== null && items.length === 0 ? (
        <Text style={s.empty}>还没有阅读记录。打开一本书，就会出现在这里。</Text>
      ) : null}
    </ScrollView>
  )
}

function HistoryRowItem({ h, s }: { h: HistoryRow; s: ReturnType<typeof StyleSheet.create> }): React.JSX.Element {
  const bg = COVER_PALETTE[h.cover_idx % COVER_PALETTE.length]
  /* 有站点真封面则显示图片；加载失败回落调色板书名缩略（与书架 CoverImage 同策略） */
  const [failed, setFailed] = useState(false)
  const hasCover = h.cover_url !== '' && !failed
  const chars = Array.from(h.title.trim())
  const shown = chars.slice(0, 2)
  const meta =
    h.progress > 0
      ? `${h.chapter_label || '阅读中'} · ${Math.round(h.progress)}%`
      : h.total_chapters > 0
        ? `共 ${h.total_chapters} 章`
        : '未开始'
  return (
    <Link href={`/book/${h.id}`} asChild>
      <Pressable
        accessibilityLabel={`继续阅读《${h.title}》`}
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={s.row}>
          <View style={[s.cover, { backgroundColor: bg }]}>
            {hasCover ? (
              <Image
                source={{ uri: h.cover_url }}
                /* 显式 40×56（与 s.cover 一致）：expo-image 在 web 把 style 同时落到 <img>，
                   百分比高度在缩略图的包裹层里会解析成 0 */
                style={{ width: 40, height: 56 }}
                contentFit="cover"
                onError={() => setFailed(true)}
                recyclingKey={h.cover_url}
                accessible
                accessibilityLabel={`《${h.title}》封面`}
              />
            ) : (
              <View style={{ flexDirection: 'row', gap: 1 }}>
                {shown.map((c, i) => (
                  <Text key={i} style={s.coverChar}>
                    {c}
                  </Text>
                ))}
              </View>
            )}
          </View>
          <View style={s.info}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {h.title}
            </Text>
            <Text style={s.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          <Text style={s.time}>{fmtReadTime(h.last_read_at)}</Text>
        </View>
      </Pressable>
    </Link>
  )
}
