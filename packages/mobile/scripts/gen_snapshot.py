# -*- coding: utf-8 -*-
"""生成移动端示例快照 assets/mozhi.db（与桌面端 schema 完全一致）。

真实云端快照由桌面端 uploadSnapshot 产出（zip 内含 mozhi.db）；
本脚本造的是「首次安装演示库」，字段与桌面端 db.ts 的建表+迁移结果一一对应。
"""
import sqlite3
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "mozhi.db"
OUT.parent.mkdir(parents=True, exist_ok=True)
if OUT.exists():
    OUT.unlink()

db = sqlite3.connect(str(OUT))
c = db.cursor()
c.executescript(
    """
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'TXT',
  cover_idx INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  chapter_label TEXT NOT NULL DEFAULT '',
  sort_at REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  total_chapters INTEGER NOT NULL DEFAULT 0,
  current_chapter INTEGER NOT NULL DEFAULT 0,
  origin_path TEXT NOT NULL DEFAULT '',
  cfi TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  download_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE chapters (
  book_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  content_edited INTEGER NOT NULL DEFAULT 0,
  dup INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, idx)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""
)

PARA = (
    "墨与纸的相遇，从来不是一件喧哗的事。砚台里的水慢慢磨开一池浓黑，"
    "笔锋落下去的时候，纸先一步安静了。",
    "我们做墨纸阅读器，是想把这种安静搬到屏幕里来——纸色的底，墨色的字，"
    "朱砂只留给自己真正在意的东西：未读的圆点、当前的章节、正在进行的抓取。",
    "你可以从云端拉下一份自己的书库快照，地铁上接着昨天的那一章往下读；"
    "读到哪里，进度就记到哪里，回到桌面端再吸收回去。",
    "阅读本身不需要更多按钮。字号、行距、四种纸色，剩下的交给内容。",
    "这一章在示例库里只占几段，真实世界里它也许是你追了一年的连载，"
    "也许是某个深夜导入的八百章长卷。屏幕小，书不小。",
)
CH_TITLES = {
    1: ["序", "匆匆", "春", "荷塘月色", "背影", "绿"],
    2: ["开篇", "第一章 墨", "第二章 纸", "第三章 字", "第四章 版", "第五章 纸的韧性",
        "第六章 墨的浓淡", "第七章 装帧", "第八章 收藏", "第九章 修复", "第十章 传家",
        "尾声"],
    3: ["山月记", "名人传", "弟子", "李陵"],
}
BOOKS = [
    (1, "匆匆·选集", "朱自清 等", "TXT", 0, 0.0, "", 30, 6, 0),
    (2, "墨与纸", "墨纸工坊", "NOVEL", 1, 42.0, "第五章 纸的韧性", 20, 12, 5),
    (3, "山月记", "中岛敦", "NOVEL", 2, 0.0, "", 10, 4, 0),
]

for bid, title, author, fmt, cover, prog, label, sort_at, nch, cur in BOOKS:
    c.execute(
        "INSERT INTO books (id,title,author,format,cover_idx,progress,chapter_label,"
        "sort_at,total_chapters,current_chapter) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (bid, title, author, fmt, cover, prog, label, sort_at, nch, cur),
    )
    for i in range(nch):
        body = "\n".join(PARA[(i + k) % len(PARA)] for k in range(5))
        c.execute(
            "INSERT INTO chapters (book_id,idx,title,content) VALUES (?,?,?,?)",
            (bid, i, CH_TITLES[bid][i], body),
        )

c.executemany(
    "INSERT INTO settings (key,value) VALUES (?,?)",
    [("mobile_theme", "paper"), ("mobile_read_size", "18"), ("mobile_read_lh", "1.9")],
)
db.commit()
n_books = c.execute("SELECT COUNT(*) FROM books").fetchone()[0]
n_ch = c.execute("SELECT COUNT(*) FROM chapters").fetchone()[0]
db.close()
print(f"OK {OUT} books={n_books} chapters={n_ch}")
sys.exit(0)
