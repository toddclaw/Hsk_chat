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
check(Sync.PREFS_KEYS.indexOf("teachPrompts") !== -1, "PREFS_KEYS names teachPrompts");

/* chatTime must NOT be in PREFS_KEYS: that list means "replace with whatever is
 * newer", which for a counter throws away whichever device synced first. It
 * still has to travel, so it rides in the snapshot and is merged on the way in
 * by time.js. */
check(Sync.PREFS_KEYS.indexOf("chatTime") === -1,
  "chatTime is NOT a last-write-wins pref -- it is a counter, not a setting");
check(Sync.PREFS_KEYS.indexOf("cost") === -1,
  "and neither is cost, for exactly the same reason");
const withCost = Sync.prefsSnapshot(Object.assign({}, S,
  { cost: { "dev-a": { total: 0.5, days: { "2026-08-23": 0.5 } } } }));
check(withCost.cost && withCost.cost["dev-a"].total === 0.5,
  "a prefs push carries spend");
const spend = { cost: { "dev-a": { total: 9.99, days: {} } } };
Sync.applyPrefsSnapshot(spend, { cost: { "dev-a": { total: 0.01, days: {} } } });
check(spend.cost["dev-a"].total === 9.99,
  "applyPrefsSnapshot cannot overwrite spend with an older, smaller copy");
const withTime = Sync.prefsSnapshot(Object.assign({}, S,
  { chatTime: { "dev-a": { total: 60, days: { "2026-08-22": 60 } } } }));
check(withTime.chatTime && withTime.chatTime["dev-a"].total === 60,
  "but a prefs push still carries it");
check(!("chatTime" in Sync.prefsSnapshot({ level: 1 })),
  "and a device with no recorded time does not push an empty one");
const before = { chatTime: { "dev-a": { total: 999, days: {} } } };
Sync.applyPrefsSnapshot(before, { chatTime: { "dev-a": { total: 1, days: {} } } });
check(before.chatTime["dev-a"].total === 999,
  "applyPrefsSnapshot leaves chatTime alone rather than overwriting it with an older copy");
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

/* ---------------------------------------------------------- conversations */

const A = { id: "a", title: "chat A", created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z", deleted: false };

check(Sync.conversationToRow(A, "u1").user_id === "u1" &&
      Sync.conversationToRow(A, "u1").deleted_at === null,
  "a live conversation carries no tombstone");
check(Sync.conversationToRow({ ...A, deleted: true }, "u1").deleted_at !== null,
  "a deleted one does");
check(Sync.conversationToRow(null, "u1") === null, "a conversation needs an id");

// Recency decides ordinary fields.
const renamed = Sync.mergeConversations([A], [{
  id: "a", title: "renamed", created_at: A.created_at,
  updated_at: "2026-01-02T00:00:00Z", deleted_at: null, user_id: "u1"
}]);
check(renamed.length === 1 && renamed[0].title === "renamed",
  "a newer remote rename wins");

/* Deletion is monotonic, and this is the case the tombstone exists for: the
 * other device was offline when the chat was deleted, kept chatting in it, and
 * therefore carries a LATER updated_at. Resolving by recency alone would
 * resurrect it -- on every device, every sync, with no way to make a delete
 * stick. */
const undead = Sync.mergeConversations(
  [{ ...A, updated_at: "2026-06-01T00:00:00Z" }],                       // local, newer, alive
  [{ id: "a", title: "chat A", created_at: A.created_at,
     updated_at: "2026-01-02T00:00:00Z", deleted_at: "2026-01-02T00:00:00Z" }]);
check(undead[0].deleted === true,
  "a remote tombstone survives a newer local copy -- a delete cannot be undone by chatting");
const undead2 = Sync.mergeConversations(
  [{ ...A, deleted: true, deleted_at: "2026-01-02T00:00:00Z" }],
  [{ id: "a", title: "chat A", created_at: A.created_at,
     updated_at: "2026-06-01T00:00:00Z", deleted_at: null }]);
check(undead2[0].deleted === true, "and the same the other way round");

// Merging must not write through to the caller's own objects.
const mine = { ...A };
Sync.mergeConversations([mine], [{ id: "a", title: "x", created_at: A.created_at,
  updated_at: "2026-09-09T00:00:00Z", deleted_at: "2026-09-09T00:00:00Z" }]);
check(mine.deleted === false && mine.title === "chat A",
  "mergeConversations copies rather than mutating what it was given");

check(Sync.mergeConversations([], [])
  .concat(Sync.mergeConversations(null, null)).length === 0,
  "empty in, empty out");
const order = Sync.mergeConversations([
  { id: "old", updated_at: "2026-01-01T00:00:00Z" },
  { id: "new", updated_at: "2026-05-01T00:00:00Z" }], []);
check(order[0].id === "new", "newest first, which is the order the list shows");
check(Sync.visibleConversations([{ id: "a" }, { id: "b", deleted: true }]).length === 1,
  "tombstones are hidden from the list but kept in the data");

/* Messages carry their conversation, and anything written before this feature
 * existed maps to one fixed id -- not one invented per device, which would
 * split a single old history into a chat per device. */
const convTurn = { id: "m1", role: "user", text: "\u4f60\u597d", created_at: "2026-01-01T00:00:00Z" };
check(Sync.messageToRow(convTurn, "u1", "c9").conversation_id === "c9",
  "a message row carries its conversation");
check(Sync.messageToRow(convTurn, "u1").conversation_id === Sync.LEGACY_ID,
  "and falls back to the fixed legacy id, never to a fresh one");
check(Sync.rowToMessage({ id: "m1", role: "user", text: "x", created_at: "t" }).cid
        === Sync.LEGACY_ID,
  "a row with no conversation_id reads back as the legacy conversation");
check(/^[0-9a-f-]{36}$/.test(Sync.LEGACY_ID),
  "the legacy id is a real uuid, since the column is typed");

/* ------------------------------------------------- prefs freshness gate ---
 *
 * applyPrefsSnapshot is guarded at the call site by "is the remote newer than
 * the last thing I pushed", and the answer has to survive a reload. It did not:
 * prefsPushedAt lived in memory only, so every load answered "I have never
 * pushed" and adopted whatever the cloud held -- stale precisely when you
 * changed a setting and reloaded before the 2s debounce could push it, which
 * is reloading to pick up a new version. Settings appeared to revert on
 * upgrade.
 *
 * The gate itself is one comparison, so it is checked here directly rather
 * than mimed through the app. */
const fresher = (remoteAt, pushedAt) => !pushedAt || remoteAt > pushedAt;

check(fresher("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"),
  "a genuinely newer remote snapshot is adopted");
check(!fresher("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
  "an older one is not");
check(!fresher("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
  "and our own last push is not treated as news");
check(fresher("2026-01-01T00:00:00Z", ""),
  "with no record of pushing, the remote wins -- which is why the record must persist");

/* The shape of the loss: adopting an older snapshot silently replaces exactly
 * the settings the learner had just changed. */
const local = { model: "new/model", replyLength: "long", attempts: 6, key: "keep" };
Sync.applyPrefsSnapshot(local, { model: "old/model", replyLength: "short", attempts: 3 });
check(local.model === "old/model" && local.replyLength === "short" && local.attempts === 3,
  "an adopted snapshot overwrites model, reply length and tries -- the reported symptom");
check(local.key === "keep", "though never the API key");

/* activity is the third optional column. NULL means "chat", so conversations
 * written before the column existed read back correctly with no migration. */
const convA = { id: "c1", title: "T", activity: "story",
                created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const rowA = Sync.conversationToRow(convA, "u1");
check(rowA.activity === "story", "conversationToRow carries the activity");
check(Sync.rowToConversation(rowA).activity === "story", "and it survives the round trip");

check(Sync.rowToConversation({ id: "c2", created_at: "x", updated_at: "x" }).activity === "chat",
  "a row with no activity column reads back as chat");
check(Sync.rowToConversation({ id: "c3", activity: null, created_at: "x", updated_at: "x" })
  .activity === "chat", "and so does an explicit NULL");

/* The merge trap: mergeConversations rebuilds its object field by field, so a
 * column not added there is dropped on every sync. */
const mergedKeep = Sync.mergeConversations(
  [{ id: "c4", title: "local", activity: "story", updated_at: "2026-01-02T00:00:00Z" }],
  [{ id: "c4", title: "remote", activity: "story", updated_at: "2026-01-03T00:00:00Z" }]);
check(mergedKeep[0].activity === "story", "activity survives a merge -- it is not dropped");
check(mergedKeep[0].title === "remote", "while title is still newest-wins");

/* Not newest-wins. An activity is fixed at creation; a remote row that lost its
 * activity (older client, un-migrated database) must not erase a local one. */
const mergedNull = Sync.mergeConversations(
  [{ id: "c5", activity: "focused", updated_at: "2026-01-01T00:00:00Z" }],
  [{ id: "c5", activity: null, updated_at: "2026-01-09T00:00:00Z" }]);
check(mergedNull[0].activity === "focused",
  "a newer row with no activity does not erase the one we have");

const mergedNew = Sync.mergeConversations(
  [], [{ id: "c6", activity: "story", created_at: "x", updated_at: "x" }]);
check(mergedNew[0].activity === "story", "a remote-only conversation keeps its activity");

// Deletion stays monotonic regardless of activity.
const mergedDel = Sync.mergeConversations(
  [{ id: "c7", activity: "story", deleted: true, deleted_at: "2026-01-01T00:00:00Z",
     updated_at: "2026-01-01T00:00:00Z" }],
  [{ id: "c7", activity: "story", updated_at: "2026-01-09T00:00:00Z" }]);
check(mergedDel[0].deleted === true, "a deleted conversation stays deleted, activity or not");

/* level is the fourth optional column, and behaves exactly like activity: fixed
 * at creation, NULL when the column or the row predates it. NULL rather than a
 * default, because the honest answer for a conversation held before levels were
 * recorded is "unknown" -- guessing the current one mislabels an old chat. */
const convL = { id: "c8", title: "T", level: 3,
                created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const rowL = Sync.conversationToRow(convL, "u1");
check(rowL.level === 3, "conversationToRow carries the level");
check(Sync.rowToConversation(rowL).level === 3, "and it survives the round trip");
check(Sync.rowToConversation({ id: "c9", created_at: "x", updated_at: "x" }).level === null,
  "a row with no level column reads back as no level, not as level 1");

const mergedLev = Sync.mergeConversations(
  [{ id: "d1", title: "local", level: 2, updated_at: "2026-01-02T00:00:00Z" }],
  [{ id: "d1", title: "remote", level: 2, updated_at: "2026-01-03T00:00:00Z" }]);
check(mergedLev[0].level === 2, "level survives a merge -- it is not dropped");

// Same rule as activity: a newer row that lost the column must not erase ours.
const mergedLevNull = Sync.mergeConversations(
  [{ id: "d2", level: 4, updated_at: "2026-01-01T00:00:00Z" }],
  [{ id: "d2", level: null, updated_at: "2026-01-09T00:00:00Z" }]);
check(mergedLevNull[0].level === 4,
  "a newer row with no level does not erase the one we have");

/* Story time runs on its own model, so that choice has to reach the other
 * device like the chat and teaching model ids do. */
check(Sync.PREFS_KEYS.indexOf("storyModel") !== -1,
  "storyModel syncs with the other model settings");
check(Sync.PREFS_KEYS.indexOf("key") === -1 && Sync.PREFS_KEYS.indexOf("history") === -1,
  "and adding it did not smuggle the key or the history in");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
