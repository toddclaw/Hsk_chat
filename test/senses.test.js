/* Ambiguous-form sense registry and per-level policy. Run: node test/senses.test.js */
const HSK = require("../validator.js");
const Senses = require("../senses.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

// A tiny lexicon standing in for a real level's: 得 standalone, plus a couple
// of compounds that fold 得 into a longer word so it never surfaces alone.
const lex = HSK.buildLexicon([
  { w: "我", p: "wǒ", d: "I" }, { w: "你", p: "nǐ", d: "you" },
  { w: "走", p: "zǒu", d: "to walk/leave" }, { w: "了", p: "le", d: "aspect particle" },
  { w: "跑", p: "pǎo", d: "to run" }, { w: "快", p: "kuài", d: "fast" },
  { w: "得", p: "de / dé / děi", d: "particle" },
  { w: "觉得", p: "juéde", d: "to feel/think" }, { w: "得到", p: "dédào", d: "to obtain" }
]);

// --- registry shape ----------------------------------------------------------
check(Senses.isRegistered("得"), "得 is registered");
check(!Senses.isRegistered("走"), "an ordinary word is not registered");
check(Senses.allowedSenses("走", 5) === null, "policy for an unregistered word is null");

// --- per-level policy (the agreed conservative default) ----------------------
check(Senses.allowedSenses("得", 0).length === 0 && Senses.allowedSenses("得", 2).length === 0,
  "HSK 0.5-2: no sense of 得 is allowed");
check(JSON.stringify(Senses.allowedSenses("得", 3)) === JSON.stringify(["de_complement"]),
  "HSK 3-4: de_complement only", JSON.stringify(Senses.allowedSenses("得", 3)));
check(JSON.stringify(Senses.allowedSenses("得", 4)) === JSON.stringify(["de_complement"]),
  "HSK 4 still de_complement only");
const l56 = Senses.allowedSenses("得", 5);
check(l56.indexOf("de_complement") !== -1 && l56.indexOf("dei_modal") !== -1,
  "HSK 5-6: dei_modal joins de_complement", JSON.stringify(l56));
const l79 = Senses.allowedSenses("得", 7);
check(l79.indexOf("de_complement") !== -1 && l79.indexOf("dei_modal") !== -1,
  "HSK 7-9: both standalone senses allowed", JSON.stringify(l79));
check(Senses.REGISTRY["得"].senses.indexOf("de_lexical") !== -1 &&
  Senses.REGISTRY["得"].standalone.indexOf("de_lexical") === -1,
  "de_lexical is documented but never offered to the standalone classifier");

// --- the trigger: only when a registered word is actually standalone --------
check(Senses.wordsPresent(HSK.segment("我觉得很好。", lex)).length === 0,
  "得 folded into 觉得 by the segmenter is not a standalone hit -- no call spent");
check(Senses.wordsPresent(HSK.segment("我得走了。", lex)).indexOf("得") !== -1,
  "a standalone 得 does trigger");
check(Senses.wordsPresent(HSK.segment("你好。", lex)).length === 0,
  "a sentence without the word at all triggers nothing");

const twoHits = HSK.segment("我跑得快，你也跑得快。", lex);
check(Senses.standaloneHits(twoHits, "得").length === 2,
  "every standalone occurrence is counted, not just the first");

// --- classification round-trip -----------------------------------------------
const prompt = Senses.classifyPrompt("得", "我得走了。", 1);
check(prompt.indexOf("得") !== -1 && prompt.indexOf("dei_modal") !== -1 &&
  prompt.indexOf("de_complement") !== -1, "classify prompt names the word and both senses");
check(prompt.indexOf("de_lexical") === -1, "classify prompt never offers de_lexical as a choice");

check(JSON.stringify(Senses.parseClassification('["dei_modal"]', 1)) === '["dei_modal"]',
  "parses a clean JSON array");
check(JSON.stringify(Senses.parseClassification(
  "Sure, here you go:\n[\"de_complement\", \"dei_modal\"]\nHope that helps!", 2)) ===
  '["de_complement","dei_modal"]', "tolerates prose wrapped around the array");
check(Senses.parseClassification("not json at all", 1) === null,
  "malformed output parses to null rather than throwing");
check(Senses.parseClassification('["dei_modal"]', 2) === null,
  "a length mismatch against the occurrence count is rejected, not silently trusted");

// --- policy check -------------------------------------------------------------
check(Senses.checkSenses("得", ["dei_modal"], 3).length === 1,
  "dei_modal at HSK 3 is a violation");
check(Senses.checkSenses("得", ["de_complement"], 3).length === 0,
  "de_complement at HSK 3 is not a violation");
check(Senses.checkSenses("得", ["de_complement", "dei_modal"], 6).length === 0,
  "both senses are clean by HSK 6");
check(Senses.checkSenses("得", ["dei_modal", "de_complement"], 0).length === 2,
  "both senses are violations at HSK 0.5, where 得 is unmet in any sense");

// --- repair prompt -------------------------------------------------------------
// No closing "try again" line here: the app's own repairPrompt (index.html)
// appends one shared closing instruction after combining this with any
// vocabulary repair text from the same attempt, so this must not duplicate it.
const rp = Senses.repairPrompt(Senses.checkSenses("得", ["dei_modal"], 3));
check(rp.indexOf("得") !== -1 && rp.indexOf("必须") !== -1,
  "repair prompt names the word and explains the disallowed sense in Chinese", rp);
check(rp.indexOf("要 / 必须") !== -1, "repair prompt offers the registered alternative");
check(rp.indexOf("再说一次") === -1, "repair prompt does not include its own closing instruction");
check(Senses.repairPrompt([]) === "", "an empty violation list yields empty text, not a dangling instruction");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
