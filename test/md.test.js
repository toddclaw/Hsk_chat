/* The Markdown subset the explain sheet renders. Run: node test/md.test.js
 *
 * Two things are being checked, and the second matters more than the first.
 * One: the marks a model actually emits come out as formatting rather than
 * literal asterisks. Two: nothing a model emits can come out as HTML. The
 * explain chat is unvalidated in both directions by design and echoes the
 * student's own words back, so the input here is untrusted twice over.
 */
const M = require("../md.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));
const eq = (got, want, label) =>
  check(got === want, label, got === want ? "" : `got:  ${got}\n    want: ${want}`);

/* 1. The marks that prompted this. Real lines from a live qwen3 answer to the
 *    grammar-check prompt -- the sheet showed every asterisk literally. */
eq(M.render("**Is it correct?** No."), "<strong>Is it correct?</strong> No.",
  "bold becomes <strong>");
eq(M.render("__also bold__"), "<strong>also bold</strong>", "underscore bold");
eq(M.render("*emphasis* here"), "<em>emphasis</em> here", "italic becomes <em>");
eq(M.render("### 🔹 Word-by-word"), "<b>🔹 Word-by-word</b>", "heading becomes a bold line");
eq(M.render("#### Deeper"), "<b>Deeper</b>", "any heading level, same treatment");
eq(M.render("- one\n- two"), "• one\n• two", "dash bullets become real bullets");
eq(M.render("* starred"), "• starred", "asterisk bullets too");
eq(M.render("  - indented"), "  • indented", "bullet indent is preserved");
eq(M.render("a\n---\nb"), "a\nb", "a horizontal rule is dropped, not drawn");
eq(M.render("`code`"), "<code>code</code>", "code spans");

// The exact shape the four-part answer arrives in.
eq(M.render("1. **What it says:** \"I have three books.\""),
  "1. <strong>What it says:</strong> &quot;I have three books.&quot;",
  "a numbered heading line renders end to end");

/* 2. Escaping. escape() must run before anything else, so that a tag in the
 *    model's output is text. Reversing the order still passes every test above
 *    and is the whole reason this file exists. */
eq(M.render("<script>alert(1)</script>"),
  "&lt;script&gt;alert(1)&lt;/script&gt;", "a script tag is inert text");
eq(M.render('<img src=x onerror="alert(1)">'),
  "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;", "an event handler is inert text");
eq(M.render("**<b>bold tag</b>**"), "<strong>&lt;b&gt;bold tag&lt;/b&gt;</strong>",
  "a tag inside emphasis is still escaped");
eq(M.render("5 > 3 && 2 < 4"), "5 &gt; 3 &amp;&amp; 2 &lt; 4", "comparison operators survive");
eq(M.render("it's"), "it&#39;s", "apostrophes are escaped");
check(M.render("[x](javascript:alert(1))").indexOf("<a") === -1,
  "links are not rendered at all, so no href can be injected");
check(M.render("`<b>x</b>`") === "<code>&lt;b&gt;x&lt;/b&gt;</code>",
  "code spans are escaped too, not treated as raw");

/* 3. Chinese text is the normal case here, and the one place a greedy rule
 *    does real damage: an explanation is mostly quoted Chinese. */
eq(M.render("**我很好** means \"I'm fine\""),
  "<strong>我很好</strong> means &quot;I&#39;m fine&quot;", "bold around Chinese");
eq(M.render("用「把」的时候"), "用「把」的时候", "CJK brackets are left alone");
eq(M.render("三 * 四"), "三 * 四", "a spaced asterisk is multiplication, not emphasis");
eq(M.render("2 * 3 * 4"), "2 * 3 * 4", "and stays that way with several of them");

/* 4. Ordering and pairing traps. Each of these produced wrong output at some
 *    point while writing render(). */
eq(M.render("**bold** and *italic*"), "<strong>bold</strong> and <em>italic</em>",
  "bold is consumed before italic, so neither eats the other");
eq(M.render("***both***"), "<strong><em>both</em></strong>", "triple marker nests");
eq(M.render("an * unpaired asterisk"), "an * unpaired asterisk", "a lone asterisk is literal");
eq(M.render("line one *not\nclosed* line two"), "line one *not\nclosed* line two",
  "italics do not run across a newline");
eq(M.render("`a * b`"), "<code>a * b</code>", "asterisks inside code are not emphasis");
eq(M.render("snake_case_name"), "snake_case_name", "single underscores are left alone");

// 5. Degenerate input must not throw or invent content.
eq(M.render(""), "", "empty string");
eq(M.render(null), "", "null");
eq(M.render(undefined), "", "undefined");
// **** is a horizontal rule in Markdown (three or more), so it goes the same
// way --- does. Two asterisks are not, and stay put.
eq(M.render("****"), "", "a run of asterisks is a rule, not empty emphasis");
eq(M.render("**"), "**", "a bare pair is left as text");
eq(M.render("plain sentence"), "plain sentence", "text with no marks is unchanged");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
