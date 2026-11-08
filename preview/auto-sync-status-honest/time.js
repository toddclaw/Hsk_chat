/* Time spent chatting, counted per device and summed for display.
 *
 * The awkward part is not the clock, it is the sync. Prefs are whole-blob
 * last-write-wins, which is right for a setting -- the newest choice wins --
 * and completely wrong for a counter: ten minutes on a phone and five on a
 * laptop would resolve to whichever synced last, silently throwing the other
 * away. A total that quietly loses time is worse than no total.
 *
 * So this is a grow-only counter, per device. Each device only ever writes its
 * own entry and only ever increases it, which makes merging a max() per field
 * and needs no coordination, no ordering and no locks -- two devices offline
 * for a week still converge to the right number. Display sums the entries.
 *
 *   { "<device-uuid>": { total: 3600, days: { "2026-08-22": 1440 } }, ... }
 *
 * Loadable in the browser (window.HSKTime) and in node (module.exports).
 */
(function (root) {
  "use strict";

  // Local date, not UTC: "today" means the day the person is having.
  function dayKey(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) +
           "-" + (day.length < 2 ? "0" + day : day);
  }

  function entry(map, id) {
    if (!map[id]) map[id] = { total: 0, days: {} };
    if (!map[id].days) map[id].days = {};
    return map[id];
  }

  /* Add seconds to one device's own entry. Nothing here ever touches another
   * device's numbers -- that is the property that makes the merge safe. */
  function add(map, id, seconds, key) {
    if (!map || !id || !(seconds > 0)) return map || {};
    var e = entry(map, id);
    key = key || dayKey();
    e.total += seconds;
    e.days[key] = (e.days[key] || 0) + seconds;
    return map;
  }

  /* Max per field. Idempotent and order-independent, so it does not matter
   * which side is "newer" or how many times it runs. */
  function merge(local, remote) {
    var out = {}, id, k;
    local = local || {}; remote = remote || {};
    for (id in local) if (Object.prototype.hasOwnProperty.call(local, id)) {
      out[id] = { total: local[id].total || 0, days: {} };
      for (k in (local[id].days || {})) out[id].days[k] = local[id].days[k];
    }
    for (id in remote) if (Object.prototype.hasOwnProperty.call(remote, id)) {
      var r = remote[id] || {}, o = entry(out, id);
      o.total = Math.max(o.total || 0, r.total || 0);
      for (k in (r.days || {})) {
        o.days[k] = Math.max(o.days[k] || 0, (r.days || {})[k] || 0);
      }
    }
    return out;
  }

  function totals(map, key) {
    key = key || dayKey();
    var today = 0, all = 0;
    for (var id in (map || {})) if (Object.prototype.hasOwnProperty.call(map, id)) {
      all += (map[id].total || 0);
      today += ((map[id].days || {})[key] || 0);
    }
    return { today: today, total: all };
  }

  /* Day buckets are only ever read for "today", so old ones are dead weight in
   * a blob that syncs. Totals are untouched -- pruning must never lose time.
   * A peer that still has an older day will re-add it on the next merge, which
   * is harmless: it is a few bytes, and it cannot change any displayed number. */
  function prune(map, keep, key) {
    keep = keep || 14;
    var cutoff = new Date(key ? key + "T00:00:00" : Date.now());
    cutoff.setDate(cutoff.getDate() - keep);
    var floor = dayKey(cutoff);
    for (var id in (map || {})) if (Object.prototype.hasOwnProperty.call(map, id)) {
      var days = map[id].days || {};
      for (var k in days) if (k < floor) delete days[k];
    }
    return map;
  }

  /* Rounded to the minute below an hour, and to the minute above it too: a
   * study total that ticks by the second invites watching it rather than the
   * Chinese. Under a minute reads as "under a minute" rather than "0 min",
   * which looks broken when you have plainly just been using it. */
  function format(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    if (seconds === 0) return "none yet";
    if (seconds < 60) return "under a minute";
    var mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + " min";
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + " h" + (m ? " " + m + " min" : "");
  }

  var api = { dayKey: dayKey, add: add, merge: merge, totals: totals,
              prune: prune, format: format };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
