#!/usr/bin/env python3
"""Make the level files strictly nested: every level contains all lower ones.

HSK 1.0 and HSK 3.0 disagree about 14 words -- 猫, 苹果, 怎么样, 火车站 and
others sit in level 1 of the old standard but at level 2, 3, 4 or nowhere in
the new one. Left alone, a learner moving from HSK 0.5 to HSK 1 would *lose*
vocabulary they had been using, which no learner would forgive.

So the lower level wins: any word present in a level is inserted into every
level above it. This is a deliberate, documented deviation -- the HSK 3.0 lists
are otherwise verbatim.
"""
import json, sys, os

def load(path):
    return json.load(open(path, encoding="utf-8"))

def save(path, entries):
    entries.sort(key=lambda e: e["w"])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

def main(paths):
    carried = {}          # word -> entry, everything seen at a lower level
    for path in paths:
        entries = load(path)
        have = {e["w"] for e in entries}
        added = [e for w, e in carried.items() if w not in have]
        if added:
            entries.extend(added)
            print(f"{os.path.basename(path)}: +{len(added)} from lower levels "
                  f"({' '.join(sorted(e['w'] for e in added))})")
            save(path, entries)
        for e in entries:
            carried.setdefault(e["w"], e)

if __name__ == "__main__":
    main(sys.argv[1:])
