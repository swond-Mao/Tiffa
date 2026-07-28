---
name: history-query
description: 跨会话历史检索。用户问「之前讨论过什么」「搜一下历史对话」「查一下以前的记录」时启用。用 Python sqlite3 直读 Tiffa 数据库。
---

# 历史对话检索

Tiffa 会话数据库（先执行 `echo $env:PORTABLE_ROOT` 获取根路径）：
```
$env:PORTABLE_ROOT/data/agent/history.db
```

## 方法

写一个临时 `.py` 文件到工作目录，用 `python` 执行查询，然后删掉。

### 搜索关键词

```python
import sqlite3, json, sys, os

KEYWORD = sys.argv[1]  # 从命令行传参
db = sqlite3.connect(os.path.join(os.environ['PORTABLE_ROOT'], 'data', 'agent', 'history.db'))
cur = db.execute("""
    SELECT s.id, s.title, m.time_created,
           json_extract(m.data, '$.role') as role,
           json_extract(p.data, '$.text') as text
    FROM message m
    JOIN part p ON p.message_id = m.id
    JOIN session s ON s.id = m.session_id
    WHERE json_extract(p.data, '$.type') = 'text'
      AND p.data LIKE ?
    ORDER BY m.time_created DESC
    LIMIT 20
""", (f'%{KEYWORD}%',))

for r in cur.fetchall():
    sid, title, ts, role, text = r
    if text and text.strip():
        print(f"[{role}] {title}")
        print(f"  {text.strip()[:200]}\n")
db.close()
```

执行：`python search.py 关键词`

### 查看完整会话

```python
import sqlite3, json, sys, os

SID = sys.argv[1]
db = sqlite3.connect(os.path.join(os.environ['PORTABLE_ROOT'], 'data', 'agent', 'history.db'))
cur = db.execute("""
    SELECT m.time_created, json_extract(m.data, '$.role') as role,
           json_extract(p.data, '$.text') as text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created ASC
""", (SID,))

for ts, role, text in cur.fetchall():
    if text and text.strip():
        print(f"\n## {role}")
        print(text.strip()[:800])
db.close()
```

执行：`python view_session.py ses_xxxxx`
