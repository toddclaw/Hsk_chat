/* Pinyin splitter: unspaced, tone-marked pinyin into syllables and tones.
 * Run: node test/pinyin.test.js  — dependency-free, like every suite here. */
const P = require("../pinyin.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expect(p, syl, tones) {
  const s = P.split(p), t = P.tones(p);
  check(same(s, syl), "split " + p, JSON.stringify(s));
  check(same(t, tones), "tones " + p, JSON.stringify(t));
}

// --- the plan's minimum ------------------------------------------------------
expect("wǒ", ["wǒ"], [3]);
expect("wǒmen", ["wǒ", "men"], [3, 0]);        // one mark, two syllables
expect("xiànzài", ["xiàn", "zài"], [4, 4]);
expect("shénme", ["shén", "me"], [2, 0]);
expect("nǐhǎo", ["nǐ", "hǎo"], [3, 3]);         // citation: sandhi is not here
expect("túshūguǎn", ["tú", "shū", "guǎn"], [2, 1, 3]);

// --- boundaries a longest match alone would get wrong ------------------------
// fang+an is blocked: a syllable opening on a/o/e mid-word is written with an
// apostrophe, so its absence says the boundary is fan|gan.
expect("fāngàn", ["fān", "gàn"], [1, 4]);
expect("Xī’ān", ["Xī", "ān"], [1, 1]);          // the apostrophe the data uses
expect("Xī'ān", ["Xī", "ān"], [1, 1]);
expect("kěnéng", ["kě", "néng"], [3, 2]);
expect("nǚ’ér", ["nǚ", "ér"], [3, 2]);          // ü survives NFD
expect("lǜsè", ["lǜ", "sè"], [4, 4]);
expect("yìdiǎnr", ["yì", "diǎnr"], [4, 3]);     // erhua rides its syllable
expect("Zhōngguó", ["Zhōng", "guó"], [1, 2]);   // capitals keep their case
expect("yī-yī", ["yī", "yī"], [1, 1]);

// --- refusals: never guess ---------------------------------------------------
check(P.split("") === null, "empty is null");
check(P.split("xyz") === null, "not pinyin is null");
check(P.split("ǎá") === null, "two marks on one syllable is null");
check(P.split("hǎo/hāo") === null, "alternatives are null, not the first one");
check(P.tones("xyz") === null, "tones of unsplittable is null");
check(P.split(null) === null, "null in, null out");

// --- the syllable set --------------------------------------------------------
check(P.SYLLABLES.indexOf("zhuang") >= 0 && P.SYLLABLES.indexOf("lüe") >= 0,
  "SYLLABLES has the long ones and ü");
check(P.SYLLABLES.indexOf("gri") < 0, "SYLLABLES has no impossible ones");
check(P.split(P.SYLLABLES.join("")) === null || true, "a whole-set run does not throw");
for (const s of P.SYLLABLES) {
  if (!same(P.split(s), [s])) { check(false, "a bare syllable splits to itself: " + s, JSON.stringify(P.split(s))); break; }
}

// --- sandhi: the tones as said ------------------------------------------------
check(same(P.sandhi([3, 3]), [2, 3]), "third before third becomes second");
check(same(P.sandhi([3, 3, 1, 3, 3]), [2, 3, 1, 2, 3]), "two separate third-tone pairs both shift");
check(same(P.sandhi([3, 0]), [3, 0]), "a neutral syllable does not trigger the third-tone rule");
check(same(P.sandhi([3, 3, 3]), null), "three thirds in a row is refused, not guessed");
check(same(P.sandhi([3, 3, 3], "\u5C55\u89C8\u9986"), null), "and refused with its characters too");
check(same(P.sandhi([4, 4], "\u4E0D\u662F"), [2, 4]), "\u4E0D is bu2 before a fourth tone");
check(same(P.sandhi([4, 2], "\u4E0D\u884C"), [4, 2]), "and stays bu4 before anything else");
check(same(P.sandhi([4], "\u4E0D"), [4]), "\u4E0D alone stays bu4");
check(same(P.sandhi([1, 4], "\u4E00\u5B9A"), [2, 4]), "\u4E00 is yi2 before a fourth tone");
check(same(P.sandhi([1, 1], "\u4E00\u5929"), [4, 1]), "\u4E00 is yi4 before a first tone");
check(same(P.sandhi([1, 2], "\u4E00\u5E74"), [4, 2]), "\u4E00 is yi4 before a second tone");
check(same(P.sandhi([1, 3], "\u4E00\u767E"), [4, 3]), "\u4E00 is yi4 before a third tone");
check(same(P.sandhi([2, 1], "\u552F\u4E00"), [2, 1]), "a final \u4E00 does not shift");
check(same(P.sandhi([1, 1], "\u4E00\u4E00"), [1, 1]), "\u4E00\u4E00 is a repetition, not a sandhi");
check(same(P.sandhi([4, 0], "\u4E0D\u4E86"), [4, 0]), "a neutral next syllable shifts nothing");
check(same(P.sandhi([4, 3], "\u4E00\u70B9\u513F"), [4, 3]), "an erhua \u513F is not a syllable to align to");
check(same(P.sandhi([1, 3], "\u4E00\u70B9\u513F"), [4, 3]), "so \u4E00 still reads its real next tone");
check(same(P.sandhi([1, 3], "\u4E00"), null), "characters that cannot align are refused");

check(same(P.citation([2, 4], "\u4E0D\u8981"), [4, 4]), "stored bu2 reads back to its citation bu4");
check(same(P.citation([2, 4], "\u4E00\u5B9A"), [1, 4]), "stored yi2 reads back to its citation yi1");
check(same(P.citation([4, 1], "\u4E00\u5929"), [1, 1]), "stored yi4 reads back too");
check(same(P.citation([4, 0, 3], "\u5BF9\u4E0D\u8D77"), [4, 0, 3]), "a neutral \u4E0D stays neutral");
check(same(P.citation([3, 3], "\u4F60\u597D"), [3, 3]), "a third-tone word is already citation");

check(P.retone("n\u01D0", 2) === "n\u00ED", "retone swaps the mark");
check(P.retone("n\u01D0", 2).length === 2, "and recomposes it");

// --- the real lists ----------------------------------------------------------
// Task 2 excludes a null word from the pool, so a null rate is a cost and a
// wrong split is a wrong answer key. Both measured on every entry: HSK 1-6
// refuses 3 of 5,334 (two "a/b" readings and the interjection ng), and every
// split has one syllable per Han character, or one fewer per erhua r.
{
  const fs = require("fs"), path = require("path");
  const strip = x => x.normalize("NFD").replace(/[\u0300-\u030C]/g, "").toLowerCase();
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk6.json")));
  let nulls = 0, wrong = [];
  for (const e of all) {
    const s = P.split(e.p);
    if (!s) { nulls++; continue; }
    const han = [...e.w].filter(c => /\p{Script=Han}/u.test(c)).length;
    const er = s.filter(x => /r$/.test(strip(x)) && strip(x) !== "er").length;
    if (s.length !== han && s.length !== han - er) wrong.push(e.w);
  }
  check(nulls <= 3, "at most 3 HSK 1-6 words refuse to split", "got " + nulls);
  check(!wrong.length, "every split matches its character count", wrong.slice(0, 5).join(" "));
}

console.log(`pinyin: ${pass} passed, ${fail} failed`);
if (fail) { console.log(bad.map(b => "  FAIL " + b).join("\n")); process.exit(1); }
