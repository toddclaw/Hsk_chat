/* Cloud sync: optional, off by default. Mirrors S.history and the three
 * vocabulary lists (extra/learning/known) to a Supabase project, plus
 * preferences as a single JSONB blob, so a signed-in learner can pick up a
 * conversation on a second device.
 *
 * Split the same way validator.js/prompt.js/pace.js/senses.js are: the top
 * half is pure data-shaping and merge logic with no network calls, directly
 * unit-testable in Node; the bottom half is a thin Supabase glue layer that
 * only works in the browser (it reaches for window.supabase, the global the
 * @supabase/supabase-js CDN script attaches) and is exercised by the
 * Playwright suite instead, the same split checkSenseViolations/callModel
 * has in index.html vs. senses.js.
 *
 * The API key and the cached OpenRouter model list are never synced -- see
 * PREFS_KEYS below, which enumerates exactly what a prefs push contains
 * rather than ever stringifying the whole S object.
 *
 * Loadable in the browser (window.HSKSync) and in node (module.exports).
 */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------- messages */

  /* turnObj.id and turnObj.created_at are assigned once, client-side, the
   * moment a message is created (see index.html) -- never server-generated.
   * That is what lets an edit to an existing message (a translation added
   * later, an explain-chat follow-up appended) upsert the same row instead
   * of creating a duplicate, and it is why two devices never have to agree
   * on whose turn gets the next id. "notice" turns (error cards) are UI,
   * not conversation, and are never synced -- same reasoning as why they
   * are excluded from windowed() in index.html. */
  function messageToRow(turnObj, userId) {
    if (!turnObj || turnObj.role === "notice" || !turnObj.id) return null;
    return {
      id: turnObj.id,
      user_id: userId,
      role: turnObj.role,
      text: turnObj.text,
      needs: turnObj.needs || null,
      attempts: turnObj.attempts == null ? null : turnObj.attempts,
      failed: !!turnObj.failed,
      truncated: !!turnObj.truncated,
      introduced: turnObj.introduced || null,
      translation: turnObj.translation || null,
      show_translation: !!turnObj.showTranslation,
      explain_chat: turnObj.explainChat && turnObj.explainChat.length ? turnObj.explainChat : null,
      created_at: turnObj.created_at,
      updated_at: new Date().toISOString()
    };
  }

  function rowToMessage(row) {
    var t = {
      id: row.id, role: row.role, text: row.text,
      created_at: row.created_at
    };
    if (row.needs) t.needs = row.needs;
    if (row.attempts != null) t.attempts = row.attempts;
    if (row.failed) t.failed = true;
    if (row.truncated) t.truncated = true;
    if (row.introduced) t.introduced = row.introduced;
    if (row.translation) t.translation = row.translation;
    if (row.show_translation) t.showTranslation = true;
    if (row.explain_chat) t.explainChat = row.explain_chat;
    return t;
  }

  /* Union local and remote history by id, keeping whichever side is newer
   * per message (so a translation added on one device after the other
   * device already synced that message is not lost), then sorted by
   * created_at with id as a tiebreaker so ordering is stable even if two
   * messages share a timestamp. Every local turnObj without an id (older
   * history saved before sync existed, or a "notice" card) passes through
   * untouched and is simply never matched against a remote row. */
  function mergeMessages(local, remote) {
    var byId = new Map();
    (local || []).forEach(function (t) { if (t && t.id) byId.set(t.id, t); });
    (remote || []).forEach(function (row) {
      var incoming = rowToMessage(row);
      var existing = byId.get(row.id);
      if (!existing || newer(incoming, existing)) byId.set(row.id, incoming);
    });
    var merged = (local || []).filter(function (t) { return !t || !t.id; })
      .concat(Array.from(byId.values()));
    merged.sort(function (a, b) {
      var ta = a.created_at || "", tb = b.created_at || "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    return merged;
  }

  // "Newer" compares the fields that can change after creation, not
  // created_at (which never changes once a message exists): a message with
  // a translation, or a longer explain-chat, is the more complete version.
  function newer(a, b) {
    var aRichness = (a.translation ? 1 : 0) + (a.explainChat ? a.explainChat.length : 0);
    var bRichness = (b.translation ? 1 : 0) + (b.explainChat ? b.explainChat.length : 0);
    return aRichness > bRichness;
  }

  /* -------------------------------------------------------------- vocab */

  /* All three vocabulary lists (S.extra, S.learning, S.known) are keyed by
   * word, so union-by-word is naturally conflict-free: two devices adding
   * different words never collide. countKey (e.g. "seen" on S.learning)
   * takes the max across both sides when a word is in both -- seen only
   * ever increases, so the higher count is always the more correct one,
   * never a value to choose between by recency. */
  function mergeWordList(local, remote, countKey) {
    var byWord = new Map();
    (local || []).forEach(function (e) { byWord.set(e.w, e); });
    (remote || []).forEach(function (e) {
      var existing = byWord.get(e.w);
      if (!existing) { byWord.set(e.w, e); return; }
      var merged = {
        w: e.w,
        p: existing.p || e.p || "",
        d: existing.d || e.d || ""
      };
      if (existing.s || e.s) merged.s = existing.s || e.s;
      if (existing.from != null || e.from != null) merged.from = existing.from != null ? existing.from : e.from;
      if (countKey) merged[countKey] = Math.max(existing[countKey] || 0, e[countKey] || 0);
      byWord.set(e.w, merged);
    });
    return Array.from(byWord.values());
  }

  function vocabToRows(list, userId) {
    return (list || []).map(function (e) {
      var row = { user_id: userId, word: e.w, p: e.p || null, d: e.d || null,
        updated_at: new Date().toISOString() };
      if (e.s !== undefined) row.sentence = e.s || null;
      if (e.seen !== undefined) row.seen = e.seen || 0;
      if (e.from !== undefined) row.from_level = e.from == null ? null : e.from;
      return row;
    });
  }

  function rowsToVocab(rows) {
    return (rows || []).map(function (row) {
      var e = { w: row.word, p: row.p || "", d: row.d || "" };
      if (row.sentence !== undefined && row.sentence !== null) e.s = row.sentence;
      if (row.seen !== undefined && row.seen !== null) e.seen = row.seen;
      if (row.from_level !== undefined && row.from_level !== null) e.from = row.from_level;
      return e;
    });
  }

  /* ------------------------------------------------------------- prefs */

  /* Exactly what a prefs push contains, enumerated rather than ever
   * stringifying the whole S object -- that is what makes it structurally
   * impossible to accidentally sync the API key or the model cache, not
   * just a matter of remembering to leave them out. */
  var PREFS_KEYS = [
    "level", "model", "mode", "pinyin", "autoAdd", "replyLength", "prompt",
    "attempts", "anki", "font", "starters", "script", "speechRate",
    "freeOnly", "modelSort", "pace", "budget"
  ];

  function prefsSnapshot(S) {
    var data = {};
    PREFS_KEYS.forEach(function (k) { data[k] = S[k]; });
    return data;
  }

  function applyPrefsSnapshot(S, data) {
    if (!data) return;
    PREFS_KEYS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(data, k)) S[k] = data[k];
    });
  }

  var api = {
    messageToRow: messageToRow,
    rowToMessage: rowToMessage,
    mergeMessages: mergeMessages,
    mergeWordList: mergeWordList,
    vocabToRows: vocabToRows,
    rowsToVocab: rowsToVocab,
    PREFS_KEYS: PREFS_KEYS,
    prefsSnapshot: prefsSnapshot,
    applyPrefsSnapshot: applyPrefsSnapshot
  };

  /* -------------------------------------------------------- Supabase glue
   *
   * Everything below only works in a browser with the supabase-js CDN
   * script loaded first (it defines window.supabase). None of it runs
   * under `node test/sync.test.js` -- that file only exercises the pure
   * functions above -- and is instead covered by the Playwright suite
   * against a mocked Supabase endpoint, the same split senses.js's
   * checkSenseViolations/callModel has.
   */
  var client = null;

  function configure(url, anonKey) {
    if (typeof window === "undefined" || !window.supabase) return null;
    client = window.supabase.createClient(url, anonKey);
    return client;
  }

  function getClient() { return client; }

  async function signInWithGitHub(redirectTo) {
    return client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectTo } });
  }
  async function signOut() { return client.auth.signOut(); }
  async function getSession() {
    var r = await client.auth.getSession();
    return (r.data && r.data.session) || null;
  }
  function onAuthChange(cb) { return client.auth.onAuthStateChange(cb); }

  async function pushMessages(rows) {
    if (!rows.length) return;
    var r = await client.from("messages").upsert(rows);
    if (r.error) throw r.error;
  }
  async function pullMessages(userId, sinceISO) {
    var q = client.from("messages").select("*").eq("user_id", userId);
    if (sinceISO) q = q.gt("created_at", sinceISO);
    var r = await q;
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function pushVocab(table, rows) {
    if (!rows.length) return;
    var r = await client.from(table).upsert(rows);
    if (r.error) throw r.error;
  }
  async function pullVocab(table, userId) {
    var r = await client.from(table).select("*").eq("user_id", userId);
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function pushPrefs(userId, data) {
    var r = await client.from("prefs").upsert(
      { user_id: userId, data: data, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
  }
  async function pullPrefs(userId) {
    var r = await client.from("prefs").select("*").eq("user_id", userId).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  Object.assign(api, {
    configure: configure,
    getClient: getClient,
    signInWithGitHub: signInWithGitHub,
    signOut: signOut,
    getSession: getSession,
    onAuthChange: onAuthChange,
    pushMessages: pushMessages,
    pullMessages: pullMessages,
    pushVocab: pushVocab,
    pullVocab: pullVocab,
    pushPrefs: pushPrefs,
    pullPrefs: pullPrefs
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
