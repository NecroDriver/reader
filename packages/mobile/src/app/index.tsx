import { useEffect, useState } from 'react'
import { Link } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { ScrollView, Pressable, Text, View } from 'react-native'
import { usePrefs } from '../theme'
import { listShelf } from '../db'
import { COVER_PALETTE, THEMES, type BookRow, type ThemeDef } from '../types'

export default function Shelf(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t = THEMES[theme]
  const [books, setBooks] = useState<BookRow[]>([])
  const [loaded, setLoaded] = useState(false)

  /* 每次回到书架重查，把阅读器写回的进度立即反映出来 */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await listShelf(db)
        if (alive) setBooks(rows)
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [db])

  const rows: BookRow[][] = []
  for (let i = 0; i < books.length; i += 3) rows.push(books.slice(i, i + 3))

  return (
    <ScrollView style={{ backgroundColor: t.bg, flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }}>
        <Text style={{ color: t.seal, fontSize: 11, letterSpacing: 2 }}>
          LIBRARY · 藏书
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '600' }}>书架</Text>
          <Text style={{ color: t.muted, fontSize: 12, marginLeft: 10 }}>
            {loaded ? `${books.length} 本图书 · 云端快照` : '读取中…'}
          </Text>
        </View>
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', paddingHorizontal: 12 }}>
          {row.map((item) => (
            <BookCard key={item.id} item={item} t={t} />
          ))}
        </View>
      ))}
      {loaded && books.length === 0 ? (
        <Text style={{ color: t.muted, textAlign: 'center', marginTop: 64, fontSize: 13 }}>
          快照里还没有书。桌面端上传后在此下载。
        </Text>
      ) : null}
    </ScrollView>
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
        style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, flex: 1, margin: 8 }]}
      >
        <View
          style={{
            aspectRatio: 5 / 7,
            backgroundColor: bg,
            borderRadius: 4,
            padding: 10,
            justifyContent: 'space-between'
          }}
        >
          <Text
            numberOfLines={3}
            style={{ color: '#F3EDE0', fontSize: 16, lineHeight: 24, fontWeight: '600' }}
          >
            {item.title}
          </Text>
          <View>
            {item.progress > 0 ? (
              <View
                style={{
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'rgba(243,237,224,.25)',
                  marginBottom: 6,
                  flexDirection: 'row'
                }}
              >
                <View
                  style={{
                    width: `${Math.min(100, item.progress)}%`,
                    backgroundColor: '#C05A42',
                    borderRadius: 2
                  }}
                />
              </View>
            ) : null}
            <Text style={{ color: 'rgba(243,237,224,.8)', fontSize: 11 }}>
              {item.author || '佚名'} · {item.format}
            </Text>
          </View>
        </View>
        <Text numberOfLines={1} style={{ color: t.ink2, fontSize: 12, marginTop: 6, paddingLeft: 2 }}>
          {meta}
        </Text>
      </Pressable>
    </Link>
  )
}
