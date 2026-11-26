import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, router, useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Image } from 'expo-image'
import { ScrollView, Pressable, Text, View } from 'react-native'
import { usePrefs } from '../../theme'
import { listShelf } from '../../db'
import { getPair, runSync } from '../../lansync'
import { getDesktopOwner } from '../../storage'
import { COVER_PALETTE, THEMES, type BookRow, type ThemeDef } from '../../types'

/* 每次 App 会话只自动同步一次（静默；失败不打扰） */
let autoSynced = false

export default function Shelf(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]
  const [books, setBooks] = useState<BookRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [owner, setOwner] = useState('')
  const syncingRef = useRef(false)

  const reload = useCallback((): (() => void) => {
    let alive = true
    void (async () => {
      try {
        const rows = await listShelf(db)
        if (alive) setBooks(rows)
        const o = await getDesktopOwner()
        if (alive) setOwner(o)
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [db])

  /* 每次回到书架重查：设置页配对/同步后的新库、阅读器写回的进度都立即反映 */
  useFocusEffect(reload)

  /* 未配对（含从未同步过）→ 默认进入配对页 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const pair = await getPair()
      if (!alive) return
      if (!pair) {
        router.replace('/pair')
        return
      }
      if (autoSynced || syncingRef.current) return
      autoSynced = true
      void (async () => {
        try {
          syncingRef.current = true
          await runSync(db)
          const rows = await listShelf(db)
          setBooks(rows)
          setOwner(await getDesktopOwner())
        } catch {
          // 静默失败：设置页有手动同步
        } finally {
          syncingRef.current = false
        }
      })()
    })()
    return () => {
      alive = false
    }
  }, [db])

  const rows: BookRow[][] = []
  for (let i = 0; i < books.length; i += 3) rows.push(books.slice(i, i + 3))

  return (
    <ScrollView style={{ backgroundColor: t.bg, flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ color: t.seal, fontSize: 11, letterSpacing: 2 }}>
          {owner ? `${owner} 的藏书` : 'LIBRARY · 藏书'}
        </Text>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '600', marginTop: 4, fontFamily: 'serif' }}>书架</Text>
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
          {loaded
            ? `${books.length} 本图书 · ${books.filter((b) => b.format === 'NOVEL').length} 本在线`
            : '读取中…'}
        </Text>
      </View>
      {rows.map((row, ri) => (
        <View key={ri}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 15 }}>
            {row.map((item) => (
              <View key={item.id} style={{ flex: 1, flexBasis: 0, paddingHorizontal: 5, paddingBottom: 0 }}>
                <BookCard item={item} t={t} />
              </View>
            ))}
          </View>
          {/* 书架板：一行封面下一块薄木板（对标实体书架的视觉锚） */}
          <View
            style={{
              height: 5,
              marginHorizontal: 10,
              marginTop: 4,
              borderRadius: 2,
              backgroundColor: '#9B8266',
              shadowColor: '#221D17',
              shadowOpacity: 0.3,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3
            }}
          />
          <View style={{ height: 18 }} />
        </View>
      ))}
      {loaded && books.length === 0 ? (
        <Text style={{ color: t.muted, textAlign: 'center', marginTop: 64, fontSize: 13 }}>
          还没有书。与桌面端配对后，书库会同步到此处。
        </Text>
      ) : null}
    </ScrollView>
  )
}

/** 封面上的格式角标：在线小说用中文，本地格式用小拉丁字 */
function FormatChip({ format }: { format: string }): React.JSX.Element {
  const label = format === 'NOVEL' ? '在线' : format
  return (
    <View style={{ backgroundColor: 'rgba(20,16,12,.28)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: '#F3EDE0', fontSize: 9, letterSpacing: 1 }}>{label}</Text>
    </View>
  )
}

/** 线装书式竖排书名：CJK 逐字竖叠，居中（对标起点封面大字） */
function VerticalTitle({ title, max = 7 }: { title: string; max?: number }): React.JSX.Element {
  const chars = Array.from(title.trim())
  const shown = chars.slice(0, max)
  if (chars.length > max) shown.push('…')
  return (
    <View style={{ alignItems: 'center', flexShrink: 0 }}>
      {shown.map((c, i) => (
        <Text
          key={i}
          style={{ color: '#F3EDE0', fontSize: 17, lineHeight: 23, fontWeight: '600', fontFamily: 'serif' }}
        >
          {c}
        </Text>
      ))}
    </View>
  )
}

function BookCard({ item, t }: { item: BookRow; t: ThemeDef }): React.JSX.Element {
  const bg = COVER_PALETTE[item.cover_idx % COVER_PALETTE.length]
  const meta =
    item.progress > 0
      ? `${item.chapter_label || ''} ${Math.round(item.progress)}%`
      : item.total_chapters > 0
        ? `共 ${item.total_chapters} 章`
        : '未读'
  return (
    <Link href={`/book/${item.id}`} asChild>
      <Pressable
        accessibilityLabel={`打开《${item.title}》`}
        style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
      >
        <CoverImage item={item} bg={bg} />
        <Text numberOfLines={1} style={{ color: t.ink2, fontSize: 11.5, marginTop: 6, textAlign: 'center' }}>
          {item.author || '佚名'} · {meta}
        </Text>
      </Pressable>
    </Link>
  )
}

/** 封面：有远程真封面（站点 og:image）→ expo-image 全幅铺满 + 角标/进度浮层；
 *  否则调色板竖排书名（本地导入书）。加载失败自动回落调色板。 */
function CoverImage({ item, bg }: { item: BookRow; bg: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const hasCover = item.cover_url !== '' && !failed
  return (
    <View
      style={{
        aspectRatio: 5 / 7,
        width: '100%',
        backgroundColor: bg,
        borderRadius: 6,
        overflow: 'hidden',
        shadowColor: '#221D17',
        shadowOpacity: 0.22,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4
      }}
    >
      {hasCover ? (
        <Image
          source={{ uri: item.cover_url }}
          style={{ flex: 1, width: '100%', height: '100%' }}
          contentFit="cover"
          onError={() => setFailed(true)}
          recyclingKey={item.cover_url}
          accessible
          accessibilityLabel={`《${item.title}》封面`}
        />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 9, paddingTop: 8, paddingBottom: 7 }}>
          <FormatChip format={item.format} />
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <VerticalTitle title={item.title} />
          </View>
          <Text style={{ color: 'rgba(243,237,224,.85)', fontSize: 10.5, letterSpacing: 0.5, textAlign: 'center' }} numberOfLines={1}>
            {item.author || '佚名'}
          </Text>
        </View>
      )}
      {hasCover ? (
        <View style={{ position: 'absolute', top: 6, left: 6 }}>
          <FormatChip format={item.format} />
        </View>
      ) : null}
      {item.progress > 0 ? (
        <View
          style={{
            position: hasCover ? 'absolute' : 'relative',
            bottom: hasCover ? 0 : undefined,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: 'rgba(34,29,23,.35)',
            flexDirection: 'row'
          }}
        >
          <View
            style={{
              width: `${Math.min(100, item.progress)}%`,
              backgroundColor: '#C05A42'
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
