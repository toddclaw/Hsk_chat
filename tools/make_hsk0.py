#!/usr/bin/env python3
"""Build data/hsk0.json -- a 150-word "HSK 0.5" starter level.

Corpus frequency alone is the wrong ordering for a first level: 谢谢, 再见 and
名字 are rare in a corpus and taught in lesson one. So a small set of
course-essential words is seeded first, and the rest of the 150 is filled by
frequency from HSK 1. Everything comes from data/hsk1.json, so HSK 0.5 is
always a strict subset of HSK 1.
"""
import json, sys

SIZE = 150

ESSENTIAL = [
    "你好", "谢谢", "再见", "请", "对不起", "名字", "叫", "中文", "汉语",
    "老师", "学生", "朋友", "爸爸", "妈妈", "家", "人", "中国",
    "吃", "喝", "水", "茶", "饭", "喜欢", "学习", "工作",
    "今天", "明天", "昨天", "现在", "点", "岁", "年", "月", "日",
    "什么", "谁", "哪", "哪儿", "几", "多少", "怎么", "为什么",
    "是", "有", "不", "没有", "很", "太", "都", "也", "和",
    "我", "你", "他", "她", "我们", "这", "那", "吗", "呢", "的",
]

def main(src, dst):
    entries = json.load(open(src, encoding="utf-8"))
    by_word = {e["w"]: e for e in entries}

    picked, seen = [], set()
    for w in ESSENTIAL:
        e = by_word.get(w)
        if e and w not in seen:
            picked.append(e); seen.add(w)

    missing = [w for w in ESSENTIAL if w not in by_word]
    if missing:
        print("not in HSK 1, skipped:", " ".join(missing))

    for e in sorted(entries, key=lambda e: e.get("f", 10 ** 9)):
        if len(picked) >= SIZE:
            break
        if e["w"] not in seen:
            picked.append(e); seen.add(e["w"])

    picked.sort(key=lambda e: e["w"])
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(picked, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"{dst}: {len(picked)} words ({len(ESSENTIAL) - len(missing)} seeded, "
          f"{len(picked) - len(ESSENTIAL) + len(missing)} by frequency)")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
