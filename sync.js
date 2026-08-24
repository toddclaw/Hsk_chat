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
  function messageToRow(turnObj, userId, conversationId) {
    if (!turnObj || turnObj.role === "notice" || !turnObj.id) return null;
    return {
      id: turnObj.id,
      user_id: userId,
      conversation_id: conversationId || turnObj.cid || LEGACY_ID,
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
      cid: row.conversation_id || LEGACY_ID,
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

  /* ------------------------------------------------------ conversations */

  /* Messages written before conversation history existed carry no
   * conversation_id. Every device maps NULL to this one fixed id rather than
   * generating its own -- two devices each inventing an id for the same old
   * history would turn one conversation into two, on a list where the whole
   * point is knowing which chat is which. */
  var LEGACY_ID = "00000000-0000-4000-8000-000000000001";

  function conversationToRow(c, userId) {
    if (!c || !c.id) return null;
    return {
      id: c.id,
      user_id: userId,
      title: c.title || null,
      created_at: c.created_at,
      updated_at: c.updated_at || new Date().toISOString(),
      deleted_at: c.deleted ? (c.deleted_at || new Date().toISOString()) : null
    };
  }

  function rowToConversation(row) {
    return {
      id: row.id,
      title: row.title || "",
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted: !!row.deleted_at,
      deleted_at: row.deleted_at || null
    };
  }

  /* Union by id, newer updated_at wins -- except deletion, which is monotonic
   * and wins from either side regardless of timestamps.
   *
   * That exception is the whole feature. A device that was offline when a chat
   * was deleted still holds it, and its local copy may carry a later
   * updated_at (it kept chatting). Resolving purely by recency would let that
   * device undelete a chat someone deliberately removed, on every device, and
   * no amount of pressing delete again would make it stick. */
  function mergeConversations(local, remote) {
    var byId = new Map();
    (local || []).forEach(function (c) { if (c && c.id) byId.set(c.id, c); });
    (remote || []).forEach(function (row) {
      var incoming = rowToConversation(row);
      var existing = byId.get(row.id);
      if (!existing) { byId.set(row.id, incoming); return; }
      var newer = (incoming.updated_at || "") > (existing.updated_at || "")
        ? incoming : existing;
      // Copied, never mutated in place: `existing` is the caller's own object.
      var merged = {
        id: newer.id, title: newer.title,
        created_at: existing.created_at || incoming.created_at,
        updated_at: newer.updated_at,
        deleted: !!(existing.deleted || incoming.deleted),
        deleted_at: existing.deleted_at || incoming.deleted_at || null
      };
      byId.set(row.id, merged);
    });
    return Array.from(byId.values()).sort(function (a, b) {
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  }

  // Newest first, tombstones dropped -- what the chat list actually shows.
  function visibleConversations(list) {
    return (list || []).filter(function (c) { return c && !c.deleted; });
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
    "level", "model", "teachModel", "mode", "pinyin", "autoAdd", "replyLength", "prompt",
    "attempts", "anki", "font", "starters", "script", "speechRate",
    "freeOnly", "modelSort", "favModels", "favOnly", "pace", "budget", "teachPrompts"
  ];

  /* chatTime rides in the same prefs blob but is deliberately NOT in the list
   * above, because the list means "replace with whatever is newer" and that is
   * exactly wrong for a counter -- ten minutes on a phone and five on a laptop
   * would resolve to whichever synced last. It is merged instead, per device,
   * by time.js. Kept out of PREFS_KEYS rather than special-cased inside
   * applyPrefsSnapshot so that the list keeps meaning one thing. */
  var MERGED_KEYS = ["chatTime", "cost"];

  function prefsSnapshot(S) {
    var data = {};
    PREFS_KEYS.forEach(function (k) { data[k] = S[k]; });
    MERGED_KEYS.forEach(function (k) { if (S[k]) data[k] = S[k]; });
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
    LEGACY_ID: LEGACY_ID,
    conversationToRow: conversationToRow,
    rowToConversation: rowToConversation,
    mergeConversations: mergeConversations,
    visibleConversations: visibleConversations,
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

  // anonKey: the project's *publishable* key (Project Settings -> API in the
  // Supabase dashboard -- called "anon key" before Supabase's 2026 rename).
  // Safe to embed in client-side code; RLS is what actually gates access.
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
    /* An unmigrated database has no conversation_id column, and upserting one
     * fails the whole batch -- so the conversation grouping is dropped rather
     * than the messages. Backing up the conversation matters more than
     * remembering which chat it was in, and the grouping comes back for free
     * once the column exists. */
    var payload = schemaHasConversations === false
      ? rows.map(function (r) {
          var copy = {};
          Object.keys(r).forEach(function (k) { if (k !== "conversation_id") copy[k] = r[k]; });
          return copy;
        })
      : rows;
    var r = await client.from("messages").upsert(payload);
    if (r.error) {
      if (isMissingSchema(r.error) && schemaHasConversations !== false) {
        schemaHasConversations = false;
        return pushMessages(rows);        // once, with the column stripped
      }
      throw r.error;
    }
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
  // Upserting the (now-shorter) local list is not enough to remove a word:
  // the row from before the deletion is still on the server and would
  // silently reappear on the next pull from another device. Word removal
  // is explicit and rare (a tap on "Remove"), so this is a plain immediate
  // call, not folded into the debounced push.
  async function deleteVocab(table, userId, word) {
    var r = await client.from(table).delete().eq("user_id", userId).eq("word", word);
    if (r.error) throw r.error;
  }
  /* Whether this project has had the conversations migration applied. Probed
   * once per session by pullConversations() below, because the app has to keep
   * working against a database whose owner has not run the SQL yet -- whoever
   * runs the deployment may not be the person reading the screen. */
  var schemaHasConversations = null;   // null = not probed yet

  function conversationsSupported() { return schemaHasConversations !== false; }

  /* PGRST205 is "table not in the schema cache" and 42P01 is Postgres's own
   * undefined_table; PGRST204 / 42703 are the column equivalents, which is what
   * a push of conversation_id hits when only the ALTER is missing. Matched on
   * code rather than message text, which is localised and changes. */
  function isMissingSchema(err) {
    if (!err) return false;
    var code = String(err.code || "");
    return code === "PGRST205" || code === "42P01" ||
           code === "PGRST204" || code === "42703";
  }

  async function pullConversations(userId) {
    var r = await client.from("conversations").select("*").eq("user_id", userId);
    if (r.error) {
      if (isMissingSchema(r.error)) { schemaHasConversations = false; return []; }
      throw r.error;
    }
    schemaHasConversations = true;
    return r.data || [];
  }

  async function pushConversations(rows) {
    if (!rows.length || schemaHasConversations === false) return;
    var r = await client.from("conversations").upsert(rows);
    if (r.error) {
      if (isMissingSchema(r.error)) { schemaHasConversations = false; return; }
      throw r.error;
    }
  }

  // Messages belonging to one conversation, gone for good. The tombstone in
  // `conversations` is what tells other devices; this just reclaims the rows.
  async function deleteConversationMessages(userId, conversationId) {
    var r = await client.from("messages").delete()
      .eq("user_id", userId).eq("conversation_id", conversationId);
    if (r.error && !isMissingSchema(r.error)) throw r.error;
  }

  async function deleteAllMessages(userId) {
    var r = await client.from("messages").delete().eq("user_id", userId);
    if (r.error) throw r.error;
  }

  /* Every table holding this user's rows. Named once so "delete everything"
   * cannot drift from the schema: a table added to db/schema.sql and forgotten
   * here would leave data behind that the app promised to remove, so
   * test/sync.test.js reads the schema and checks this list still matches it. */
  var USER_TABLES = ["conversations", "messages", "vocab_extra", "vocab_learning",
                     "vocab_known", "prefs"];

  /* Sequential rather than Promise.all: the point of this call is that the user
   * is told the truth about what happened, and a partial failure buried inside a
   * rejected batch cannot say which tables were already cleared. Whatever threw
   * stops the run and reaches the caller, which reports it. */
  async function deleteAllCloudData(userId) {
    for (var i = 0; i < USER_TABLES.length; i++) {
      var r = await client.from(USER_TABLES[i]).delete().eq("user_id", userId);
      if (r.error) throw r.error;
    }
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
    pullConversations: pullConversations,
    pushConversations: pushConversations,
    deleteConversationMessages: deleteConversationMessages,
    conversationsSupported: conversationsSupported,
    pushVocab: pushVocab,
    pullVocab: pullVocab,
    deleteVocab: deleteVocab,
    deleteAllMessages: deleteAllMessages,
    USER_TABLES: USER_TABLES,
    deleteAllCloudData: deleteAllCloudData,
    pushPrefs: pushPrefs,
    pullPrefs: pullPrefs
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
