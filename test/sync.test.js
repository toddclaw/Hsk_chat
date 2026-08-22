/* Cloud sync's pure data-shaping and merge logic. Run: node test/sync.test.js
 * The Supabase glue half of sync.js (everything after "Supabase glue" in
 * the file) has no network calls to test here -- it is exercised by the
 * Playwright suite against a mocked Supabase endpoint instead. */
const fs = require("fs");
const path = require("path");
const Sync = require("../sync.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const USER = "11111111-1111-1111-1111-111111111111";

// --- messages: row shape, and never syncing notice cards --------------------
const turn = {
  id: "aaaaaaaa-0000-0000-0000-000000000001", role: "assistant", text: "你好！",
  needs: [], attempts: 2, failed: false, truncated: false,
  created_at: "2026-08-21T10:00:00.000Z"
};
const row = Sync.messageToRow(turn, USER);
check(row.id === turn.id && row.user_id === USER && row.text === "你好！" && row.attempts === 2,
  "messageToRow carries the client id, user, text and attempts through");
check(row.translation === null && row.show_translation === false,
  "absent optional fields become explicit null/false, not undefined");

check(Sync.messageToRow({ role: "notice", text: "oops" }, USER) === null,
  "a notice card (error UI, not conversation) never becomes a row");
check(Sync.messageToRow({ role: "user", text: "hi" }, USER) === null,
  "a message with no client-assigned id is never synced (pre-sync history)");

const back = Sync.rowToMessage(row);
check(back.id === turn.id && back.text === turn.text && back.attempts === 2,
  "rowToMessage round-trips id/text/attempts");
check(!("failed" in back) && !("truncated" in back),
  "false/absent flags are omitted on the way back, matching a fresh local turnObj's shape");

// --- mergeMessages: union by id, richer side wins on conflict ---------------
const localHist = [
  { id: "m1", role: "user", text: "你好", created_at: "2026-08-21T09:00:00.000Z" },
  { id: "m2", role: "assistant", text: "我很好", created_at: "2026-08-21T09:00:05.000Z" }
];
const remoteRows = [
  { id: "m2", role: "assistant", text: "我很好", created_at: "2026-08-21T09:00:05.000Z",
    translation: "I'm well", show_translation: true },
  { id: "m3", role: "user", text: "你呢？", created_at: "2026-08-21T09:00:10.000Z" }
];
const merged = Sync.mergeMessages(localHist, remoteRows);
check(merged.length === 3, "union includes every message from both sides, no duplicates",
  merged.map(m => m.id).join(","));
check(merged.map(m => m.id).join(",") === "m1,m2,m3", "merged history is ordered by created_at");
const m2 = merged.find(m => m.id === "m2");
check(m2.translation === "I'm well" && m2.showTranslation === true,
  "a richer remote version (has a translation the local copy lacks) wins the merge");

const noticeAndSyncable = [{ role: "notice", kind: "http" }, { id: "m1", role: "user", text: "hi", created_at: "t" }];
const mergedWithNotice = Sync.mergeMessages(noticeAndSyncable, []);
check(mergedWithNotice.some(t => t.role === "notice"),
  "a local notice card survives a merge untouched rather than being dropped");

// --- vocab: row shape and word-keyed merge ----------------------------------
const extraRows = Sync.vocabToRows([{ w: "苹果", p: "píngguǒ", d: "apple", s: "我喜欢苹果。" }], USER);
check(extraRows[0].word === "苹果" && extraRows[0].sentence === "我喜欢苹果。",
  "vocabToRows carries the example sentence through for S.extra-shaped entries");
check(Sync.rowsToVocab(extraRows)[0].s === "我喜欢苹果。", "rowsToVocab round-trips it back to `s`");

const learningRows = Sync.vocabToRows([{ w: "让", p: "ràng", d: "to let", seen: 2, from: 2 }], USER);
check(learningRows[0].seen === 2 && learningRows[0].from_level === 2,
  "vocabToRows maps S.learning's seen/from to seen/from_level");
check(Sync.rowsToVocab(learningRows)[0].seen === 2 && Sync.rowsToVocab(learningRows)[0].from === 2,
  "rowsToVocab round-trips seen/from_level back to seen/from");

const localLearning = [{ w: "让", p: "ràng", d: "to let", seen: 1, from: 2 }];
const remoteLearning = [{ w: "让", p: "ràng", d: "to let", seen: 3, from: 2 },
                          { w: "但", p: "dàn", d: "but", seen: 0, from: 2 }];
const mergedLearning = Sync.mergeWordList(localLearning, remoteLearning, "seen");
check(mergedLearning.length === 2, "union of learning words from both sides");
check(mergedLearning.find(e => e.w === "让").seen === 3,
  "seen count takes the max across devices -- it only ever increases, so higher is always safer");
check(mergedLearning.find(e => e.w === "但"), "a word only the remote side has is still included");

const localKnown = [{ w: "苹果", p: "", d: "" }];
const remoteKnown = [{ w: "苹果", p: "píngguǒ", d: "apple" }];
check(Sync.mergeWordList(localKnown, remoteKnown)[0].p === "píngguǒ",
  "when one side has richer p/d and the other is blank, the richer side wins even with no seen count");

// --- prefs: exactly the enumerated keys, never the API key or model cache --
const S = {
  level: 3, model: "x/y", teachModel: "big/model", mode: "without-list", pinyin: "extra", autoAdd: true,
  replyLength: "short", prompt: "", attempts: 3, anki: { deck: "Default" }, font: 26,
  starters: true, script: "simp", speechRate: 0.8, freeOnly: false, modelSort: "price",
  pace: { on: false, rate: 45 }, budget: {},
  key: "sk-or-super-secret-should-never-sync", history: [{ role: "user", text: "hi" }],
  extra: [{ w: "苹果" }]
};
const snap = Sync.prefsSnapshot(S);
check(!("key" in snap) && !("history" in snap) && !("extra" in snap),
  "prefsSnapshot never includes the API key, history, or vocab -- only the enumerated PREFS_KEYS");
check(snap.level === 3 && snap.script === "simp" && JSON.stringify(snap.anki) === JSON.stringify({ deck: "Default" }),
  "prefsSnapshot carries every enumerated preference field");
check(Sync.PREFS_KEYS.indexOf("key") === -1 && Sync.PREFS_KEYS.indexOf("history") === -1,
  "PREFS_KEYS itself never names the key or history -- not just an accident of this snapshot");

/* The teaching model is a separate preference from the chat model, and both
 * have to travel: a device that synced only one would silently start doing its
 * grammar checks on whatever it happened to be chatting with. */
check(snap.teachModel === "big/model" && snap.model === "x/y",
  "prefsSnapshot carries the teaching model alongside the chat model");
check(Sync.PREFS_KEYS.indexOf("teachModel") !== -1, "PREFS_KEYS names teachModel");
const S3 = { model: "a/b", teachModel: "c/d" };
Sync.applyPrefsSnapshot(S3, { model: "e/f", teachModel: "" });
check(S3.teachModel === "",
  "an empty teaching model survives the round trip -- it means \"same as chat\", not \"unset\"");

const S2 = { key: "should-stay", history: [], level: 1, script: "simp" };
Sync.applyPrefsSnapshot(S2, { level: 5, script: "trad" });
check(S2.level === 5 && S2.script === "trad", "applyPrefsSnapshot overwrites only the fields present in the snapshot");
check(S2.key === "should-stay", "applyPrefsSnapshot never touches fields outside PREFS_KEYS, the API key included");

// --- delete everything: the list of tables must not drift from the schema ---
/* "Delete all cloud data" is only honest if it names every table holding this
 * user's rows. A table added to db/schema.sql and forgotten in sync.js would
 * leave behind data the app told the user it had removed, which is the one
 * failure this feature must not have. */
const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
const declared = [...schema.matchAll(/create table if not exists public\.(\w+)/g)]
  .map(m => m[1])
  .filter(t => !t.startsWith("_"));   // _keepalive holds no user rows
const listed = Sync.USER_TABLES;
check(declared.length > 0, "the schema declares tables to check against");
check(declared.every(t => listed.includes(t)) && listed.every(t => declared.includes(t)),
  "USER_TABLES matches every user table in db/schema.sql",
  `schema [${declared.slice().sort()}] vs sync.js [${listed.slice().sort()}]`);
check(listed.includes("messages") && listed.includes("prefs"),
  "USER_TABLES covers the conversation and the preferences row, not just vocabulary");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
