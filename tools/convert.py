#!/usr/bin/env python3
"""Build data/hsk<N>.json from the HSK 3.0 syllabus TSV.

    python3 tools/convert.py hsk_word_list.tsv

Input is the parsed official syllabus from
https://github.com/Punpuf/hsk-syllabus-vocabulary-parser -- one row per word,
columns: word_index, level, word, pinyin, part_of_speech, pinyin_numbered,
pinyin_cc-cedict, traditional_cc-cedict, definition_cc-cedict.

Output is cumulative: data/hsk2.json contains every HSK 1 word as well, which
is what the validator wants (a level is the whole allowlist, not the band's
own additions) and what makes the coverage arithmetic in pace.js meaningful.

    [{"w":"你好","p":"nǐhǎo","d":"hello","f":384,"t":null}, ...]

`f` is a corpus frequency rank, lower being commoner. The syllabus carries no
frequency at all, and pace.js needs one for everything it does -- ordering what
gets introduced, weighting coverage, counting words to the next threshold. It
is joined in from tools/hsk-frequency.json, extracted from the previous
wordlists. Words with no rank are written without `f` and weigh nothing in the
coverage estimate; at HSK 1 and 2 that is 7 words and 0 words respectively, so
the levels the progress panel actually reasons about are effectively complete.
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FREQ = os.path.join(HERE, "hsk-frequency.json")

# Band ids as the app numbers them. "7-9" is one combined band, id 7.
LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"]


def clean_word(w):
    """Strip the syllabus's homograph suffix: 点1 / 点2 are one written word.

    Ninety entries carry one. They disambiguate readings or parts of speech in
    the syllabus, but the app matches on the written form -- a lexicon keyed by
    "点1" would never match 点 in a sentence, so the word would be invisible to
    the validator while still counting toward the level's size."""
    return re.sub(r"\d+$", "", w.strip())


# How many senses a gloss keeps. This string is rendered under a tapped word
# in a chat, not in a dictionary: the syllabus merges every CC-CEDICT sense of
# every reading, so 点 arrives with 559 characters of them and 和 with 250.
# Six covers the ordinary polysemy of a function word while staying readable on
# a phone; the reference list is there for anyone who wants the full entry.
MAX_SENSES = 6


def clean_def(d):
    """CC-CEDICT senses are /-separated, with reference-work notation inside.

    "(coll.) father; dad/CL:個|个[ge4],位[wei4]" -> "(coll.) father; dad"
    "variant of 個|个[ge4]"                     -> "variant of 个"

    Three things go. CL: classifier notes, which are notation rather than
    meaning. Bracketed numbered pinyin ([ge4]), which is how a dictionary
    cross-references and how nothing else writes a definition. And the
    traditional half of a 傳統|简体 pair, keeping the simplified -- the app's
    own data is simplified, and showing both mid-gloss reads as a typo."""
    parts = [p.strip() for p in d.split("/") if p.strip()]
    parts = [p for p in parts if not p.startswith("CL:")]
    out = []
    for p in parts:
        p = re.sub(r"\[[^\]]*\]", "", p)              # [ge4]
        # "(Taiwan pr. [han4])" is a pronunciation cross-reference, and once the
        # bracket goes it reads as an unfinished sentence. Drop the whole aside.
        p = re.sub(r"\s*\([^)]*\bpr\.\s*\)", "", p)
        p = re.sub(r"[\u4e00-\u9fff]+\|([\u4e00-\u9fff]+)", r"\1", p)   # 個|个 -> 个
        p = re.sub(r"\s{2,}", " ", p).strip(" ,;")
        if p:
            out.append(p)
    if len(out) > MAX_SENSES:
        out = out[:MAX_SENSES] + ["…"]
    return "; ".join(out)


def traditional(simp, field):
    """The traditional form, or None when it is the same as the simplified.

    CC-CEDICT lists variants /-separated (咊/和/龢, 吃/喫, 個/箇). Taking the
    first is wrong often enough to matter -- 和's first listed variant is the
    rare 咊. But if the simplified form is itself among the variants, then the
    simplified IS the standard traditional and there is nothing to convert;
    only when it is absent is a real conversion needed, and then the first
    variant is the standard one (个 -> 個)."""
    variants = [v.strip() for v in (field or "").split("/") if v.strip()]
    if not variants or simp in variants:
        return None
    return variants[0]


def main(tsv_path):
    with open(FREQ, encoding="utf-8") as fh:
        freq = json.load(fh)

    with open(tsv_path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))

    # A word listed at two levels belongs at the earlier one -- 半 appears at
    # both 1 and 4 for different senses, and a learner who met it at HSK 1 has
    # met it. Keeping the later listing would also drop it out of hsk1.json
    # while the app still expects HSK 1 to be self-contained.
    order = {lv: i for i, lv in enumerate(LEVELS)}
    best = {}
    for r in rows:
        w = clean_word(r["word"])
        if not w:
            continue
        lv = r["level"]
        if lv not in order:
            sys.exit("unknown level %r" % lv)
        prev = best.get(w)
        if prev is None or order[lv] < order[prev["level"]]:
            best[w] = {"level": lv, "row": r}

    counts = []
    seen = []
    for lv in LEVELS:
        for w, hit in best.items():
            if hit["level"] != lv:
                continue
            r = hit["row"]
            entry = {"w": w, "p": r["pinyin"].strip(), "d": clean_def(r["definition_cc-cedict"])}
            rank = freq.get(w)
            if rank:
                entry["f"] = rank
            t = traditional(w, r["traditional_cc-cedict"])
            if t:
                entry["t"] = t
            seen.append(entry)
        # Sorted by frequency so the file itself reads commonest-first; the app
        # re-sorts for its own purposes but this makes the data inspectable.
        out = sorted(seen, key=lambda e: (e.get("f", 10 ** 9), e["w"]))
        n = LEVELS.index(lv) + 1
        path = os.path.join(ROOT, "data", "hsk%d.json" % n)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        counts.append((n, len(out)))
        print("data/hsk%d.json  %5d words" % (n, len(out)))

    print("\ncumulative: " + " / ".join(str(c) for _, c in counts))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
