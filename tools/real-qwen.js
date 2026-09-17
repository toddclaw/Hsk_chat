/* The labelled real partner turns, minus the ones Sonnet wrote.
 *
 * Two files hold half the answer each. `real-partner.json` carries the turns
 * that were labelled, keyed R0001..R0308, and it was pulled before anyone knew
 * the activity mattered -- so it has no idea which model wrote any row. The
 * re-pull, `chat-export.json`, has `conversations.activity` and therefore the
 * model, but its ids are M-ids the labels know nothing about. Round nineteen is
 * why the join has to happen at all: story time runs on claude-sonnet-4.5 and
 * everything else on qwen, and pooling the two produced a headline that was
 * exactly backwards.
 *
 * The join is on the text, which is exact here: 285 of 308 match a single
 * activity, 0 match nothing, and the 23 that match several are every one of them
 * the stub 我不会说 / 我不知道 -- which the labelling had already excluded, so
 * nothing labelled is lost to the ambiguity.
 *
 * Level comes from the conversation. 50 qwen rows have none (an older
 * conversation row), and every row that does have one says 2, so 2 is the
 * fallback rather than a guess.
 *
 * Output goes OUTSIDE the repository, like its inputs: this is real user
 * writing and there is no .gitignore here.
 *
 *   node tools/real-qwen.js
 *   node tools/partner-corpus.js --grade --arm lens \
 *     --corpus ../../real-qwen.json --labels ../../real-qwen-labels.json
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const D = f => path.join(os.homedir(), "Documents", f);

const ex = JSON.parse(fs.readFileSync(D("chat-export.json"), "utf8")).items;
const rp = JSON.parse(fs.readFileSync(D("real-partner.json"), "utf8")).items;
const L = JSON.parse(fs.readFileSync(D("real-partner-labels.json"), "utf8"));

const by = new Map();   // text -> {acts, level}
for (const m of ex) {
  if (m.role !== "assistant") continue;
  const t = m.text.trim(), e = by.get(t) || { acts: new Set(), level: null };
  e.acts.add(m.activity || null);
  if (m.level) e.level = m.level;
  by.set(t, e);
}

const items = [], dropped = { unmatched: 0, ambiguous: 0, sonnet: 0 };
for (const r of rp) {
  const e = by.get(r.text.trim());
  if (!e) { dropped.unmatched++; continue; }
  if (e.acts.size > 1) { dropped.ambiguous++; continue; }
  const activity = [...e.acts][0];
  if (activity === "story" || activity === null) { dropped.sonnet++; continue; }
  items.push({ id: r.id, text: r.text, level: e.level || 2, activity: activity, day: r.day });
}

const keep = new Set(items.map(i => i.id));
const labels = { _note: "real-partner-labels.json restricted to the qwen activities. " +
                        "Built by tools/real-qwen.js -- do not hand-edit.",
                 wrong: L.wrong.filter(id => keep.has(id)),
                 unnatural: L.unnatural.filter(id => keep.has(id)),
                 english: (L.english || []).filter(id => keep.has(id)) };

fs.writeFileSync(D("real-qwen.json"), JSON.stringify({
  built: new Date().toISOString(),
  note: "Real partner turns from the app's database, qwen activities only. " +
        "Built by tools/real-qwen.js from chat-export.json + real-partner.json.",
  items: items }, null, 1));
fs.writeFileSync(D("real-qwen-labels.json"), JSON.stringify(labels, null, 1));

const n = a => items.filter(i => i.activity === a).length;
console.log(items.length + " qwen turns  (chat " + n("chat") + ", focused " + n("focused") +
            ", twenty " + n("twenty") + ", drill " + n("drill") + ")");
console.log("dropped: " + dropped.sonnet + " Sonnet/unknown, " + dropped.ambiguous +
            " stub (ambiguous activity), " + dropped.unmatched + " unmatched");
console.log("labels: " + labels.wrong.length + " wrong, " + labels.unnatural.length +
            " unnatural, " + labels.english.length + " english");
