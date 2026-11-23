# 一次性：用新广告规则清洗已导入书籍的章节内容（与 parsers.ts 规则同步）
import sqlite3, re, sys

DB = r'C:\Users\11934\AppData\Roaming\墨纸 Mozhi Reader-dev\mozhi.db'
SITE = re.compile(r'https?://|www\.|[\w-]+\.(com|net|tw|cc|org|me)|爱下电子书|更多电子书|请访问|TXT下载|txt下载|用户上传之内容|本书来自|更多精彩小说', re.I)
OPEN_WRAP = re.compile(r'^[-=─━*·•]{5,}$|^[-=─━*·•]{4,}[^-=─━*·•]{1,30}[-=─━*·•]{4,}$')

db = sqlite3.connect(DB)
rows = db.execute("SELECT book_id, idx, content FROM chapters WHERE book_id IN (SELECT id FROM books WHERE format IN ('TXT'))").fetchall()
changed = 0
for bid, idx, content in rows:
    lines = content.split('\n')
    open_scope = idx == 0
    kept = [l for l in lines if not (SITE.search(l) or (open_scope and OPEN_WRAP.match(l.strip())))]
    if len(kept) != len(lines):
        db.execute('UPDATE chapters SET content=? WHERE book_id=? AND idx=?', ('\n'.join(kept), bid, idx))
        changed += 1
db.commit()
print('chapters cleaned:', changed, 'of', len(rows))
db.close()
