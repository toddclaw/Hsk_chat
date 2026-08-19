#!/usr/bin/env python3
"""Convert complete-hsk-vocabulary level files to the app's {w,p,d} format.

Input:  the upstream HSK 3.0 level dumps (rich, ~1-2MB each)
Output: data/hsk<N>.json  ->  [{"w":"你好","p":"nǐ hǎo","d":"hello"}, ...]
"""
import json, sys, os

# CC-CEDICT writes ü as "u:" and a few entries leak the numeric form (nu:3).
UMLAUT = {"u:1": "ǖ", "u:2": "ǘ", "u:3": "ǚ", "u:4": "ǜ", "u:5": "ü", "u:": "ü"}

# Function words a frequency-free heuristic always gets wrong: the rare literary
# reading carries more dictionary senses than the everyday particle.
PREFERRED = {
    "吗": "ma", "吧": "ba", "着": "zhe", "那": "nà", "重": "zhòng",
    "了": "le", "得": "de", "不": "bù", "一": "yī", "么": "me",
    "没": "méi", "雨": "yǔ", "教": "jiāo", "为": "wèi", "行": "xíng",
}


def fix_umlaut(p):
    for k, v in sorted(UMLAUT.items(), key=lambda kv: -len(kv[0])):
        p = p.replace(k, v)
    return p


def reading(form):
    return fix_umlaut(form.get("transcriptions", {}).get("pinyin", "").strip())


def traditional(word, forms):
    """The traditional form of the preferred reading, omitted when it matches
    the simplified. About 3% of entries list several (variant characters such as
    岸/㟁, 幫/幇/幚); taking the preferred reading's form picks the standard one."""
    t = (forms[0].get("traditional") or "").strip()
    return t if t and t != word else None


def is_surname(form):
    ms = form.get("meanings", [])
    return bool(ms) and all(m.lower().startswith("surname") for m in ms)


def ordered(word, forms):
    """Rank readings: explicit override first, then surname-only readings last,
    then the reading carrying the most dictionary senses (a decent proxy for
    the everyday one -- 打 dǎ over dá, 看 kàn over kān)."""
    pref = PREFERRED.get(word)
    return sorted(forms, key=lambda f: (
        0 if pref and reading(f) == pref else 1,
        is_surname(f),
        -len(f.get("meanings", [])),
    ))


def gloss(forms, limit=3):
    seen, out = set(), []
    for f in forms:
        for m in f.get("meanings", []):
            m = m.strip()
            if m and m not in seen:
                seen.add(m); out.append(m)
    return "; ".join(out[:limit])

def pinyin(forms):
    """First reading is what the ruby shows; keep at most one alternate."""
    seen, out = set(), []
    for f in forms:
        p = reading(f)
        k = p.lower()
        if p and k not in seen:
            seen.add(k); out.append(p)
    return " / ".join(out[:2])

def convert(src, dst):
    data = json.load(open(src, encoding="utf-8"))
    merged, freq = {}, {}
    for e in data:
        merged.setdefault(e["simplified"], []).extend(e["forms"])
        r = e.get("frequency")
        if r and (e["simplified"] not in freq or r < freq[e["simplified"]]):
            freq[e["simplified"]] = r
    out = []
    for w, f in merged.items():
        f = ordered(w, f)
        entry = {"w": w, "p": pinyin(f), "d": gloss(f)}
        # Corpus frequency rank, lower being commoner. It decides the order new
        # words are introduced in, so the useful ones come first.
        rank = freq.get(w)
        if rank:
            entry["f"] = rank
        t = traditional(w, f)
        if t:
            entry["t"] = t
        out.append(entry)
    out.sort(key=lambda x: x["w"])
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"{dst}: {len(out)} entries, maxLen {max(len(x['w']) for x in out)}")

if __name__ == "__main__":
    for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
        convert(src, dst)
