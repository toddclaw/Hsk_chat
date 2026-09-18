#!/usr/bin/env python3
"""Reconcile the published previews against the branches that actually exist.

Replaces four scripts (update-branches, cleanup-branch, get-latest-branch,
generate-redirect) and the recent-branches.json they passed between them.

That file was a hand-maintained mirror of "which branches have previews", kept
by adding an entry on publish and removing one on delete. A mirror only stays
true if every event reaches it, and events here get dropped routinely: the
Publish workflow's concurrency group keeps just one run pending, so deleting
several branches at once cancels all but the last, and each cancelled run was
the only thing that would ever have removed its preview.

So this asks git instead. The live branch list is the truth, the directories on
gh-pages are the state, and anything in the second without the first is an
orphan -- which makes the reconcile idempotent, and makes a dropped run cost
nothing but a delay: the next publish of any branch cleans up what the
cancelled one missed.
"""
import html
import os
import shutil
import sys


def safe_name(branch):
    """Slashes are legal in branch names but not wanted in a path.

    Must match the workflow's `tr '/' '-'`, which is what named the directory.
    """
    return branch.replace("/", "-")


def reconcile(preview_dir, live_branches, owner, repo, latest=None):
    """Prune orphaned previews, then write the index. Returns (kept, removed).

    `latest` is the branch just published, or None when called from a delete
    event. It is only marked as such if its directory survived the prune.
    """
    by_dir = {safe_name(b): b for b in live_branches}

    removed = []
    for entry in sorted(os.listdir(preview_dir)):
        path = os.path.join(preview_dir, entry)
        if not os.path.isdir(path):
            # recent-branches.json is the state file this script exists to
            # replace; anything else loose in here is likewise not a preview.
            if entry != "index.html":
                os.remove(path)
            continue
        if entry not in by_dir:
            shutil.rmtree(path)
            removed.append(entry)

    kept = sorted(d for d in os.listdir(preview_dir)
                  if os.path.isdir(os.path.join(preview_dir, d)))

    index = os.path.join(preview_dir, "index.html")
    if not kept:
        # Nothing left to point at. An index promising previews that are gone
        # is worse than a 404, which is at least honest.
        if os.path.exists(index):
            os.remove(index)
        return kept, removed

    # A push to main or a delete event publishes no preview of its own, and
    # `target` is now only a label -- so it stays empty rather than guessing.
    # It used to fall back to the sole survivor, which was load-bearing while
    # this page redirected; as a caption, "just published" about a branch
    # nobody pushed is simply false.
    target = safe_name(latest) if latest and safe_name(latest) in by_dir else None
    if target and target not in kept:
        target = None

    with open(index, "w") as f:
        f.write(render(kept, by_dir, target, owner, repo))
    return kept, removed


def render(kept, by_dir, target, owner, repo):
    """The preview index: a list of every live preview, with the one just
    published marked.

    This page used to carry a zero-delay <meta refresh> to that branch, on the
    phone argument that /preview/ should land on the build you just pushed
    without a tap. In use it flashed past unread and took you somewhere before
    you had seen the choice, which is the opposite of what a chooser is for.
    Landing on the list costs one tap and is the whole point of the page.
    """
    e = html.escape
    rows = "\n".join(
        '  <li><a href="./%s/">%s</a>%s</li>' % (
            e(d), e(by_dir.get(d, d)), " &larr; just published" if d == target else "")
        for d in kept)
    heading = ("Just published: <code>%s</code>. " % e(by_dir.get(target, target))
               if target else "")
    return f'''<!DOCTYPE html>
<meta charset="utf-8">
<title>HSK Chat Preview</title>
<meta name="robots" content="noindex">
<style>
  body{{background:#0f1317;color:#e8edf2;font:16px/1.5 system-ui,sans-serif;padding:40px}}
  .banner{{background:#2a343e;border:1px solid #5a4a22;border-radius:10px;padding:20px}}
  .warning{{color:#ffd479}}
  a{{color:#6aa9ff}}
  code{{background:#1a2026;padding:2px 6px;border-radius:4px}}
  ul{{padding-left:20px}}
</style>
<div class="banner">
  <b class="warning">&#9888; Preview builds</b> &mdash; feature branches, not production.
  <p>{heading}<a href="https://{e(owner)}.github.io/{e(repo)}/">Go to production</a></p>
  <ul>
{rows}
  </ul>
</div>
'''


def selftest():
    """The prune rule and the just-published marker, which are the two things a
    silently-broken cleanup job would get wrong again."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        def dirs(*names):
            for e in os.listdir(d):
                p = os.path.join(d, e)
                shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            for n in names:
                os.makedirs(os.path.join(d, n))

        def page():
            return open(os.path.join(d, "index.html")).read()

        # The prune rule, and the state file this script exists to replace.
        dirs("main-ish", "feat-a", "claude-old", "v71")
        open(os.path.join(d, "recent-branches.json"), "w").write("[]")
        kept, removed = reconcile(d, ["feat/a", "main-ish"], "o", "r", latest="feat/a")
        assert kept == ["feat-a", "main-ish"], kept
        assert removed == ["claude-old", "v71"], removed
        assert not os.path.exists(os.path.join(d, "recent-branches.json")), "state file left behind"
        assert "just published" in page(), "published branch not marked"
        assert "http-equiv" not in page(), "the index must never redirect -- it is a chooser"
        assert "./main-ish/" in page(), "surviving preview missing from the list"
        assert "v71" not in page(), "pruned preview still listed"

        # Idempotent: a re-run removes nothing and keeps the same set, which is
        # what lets a dropped cleanup run cost only a delay.
        kept2, removed2 = reconcile(d, ["feat/a", "main-ish"], "o", "r", latest="feat/a")
        assert kept2 == kept and removed2 == [], (kept2, removed2)

        # Nothing was published here, so nothing may be captioned as though it
        # was -- and the list has to survive every one of these.
        for label, have, live, latest in [
            ("no branch published", ["main-ish", "feat-a"], ["feat/a", "main-ish"], None),
            ("target was pruned", ["main-ish", "feat-a"], ["feat/a", "main-ish"], "claude/old"),
            ("target is live but has no preview dir",
             ["main-ish", "feat-a"], ["feat/a", "main-ish", "x/y"], "x/y"),
            # The sole survivor used to be captioned by default, to keep the
            # redirect alive across a push to main. There is no redirect now.
            ("sole survivor, nothing published", ["feat-a"], ["feat/a"], None),
        ]:
            dirs(*have)
            reconcile(d, live, "o", "r", latest=latest)
            assert "http-equiv" not in page(), "redirected: " + label
            assert "just published" not in page(), "captioned as published: " + label
            assert "./feat-a/" in page(), "list lost: " + label
        assert "x-y" not in page(), "listed a preview that does not exist"

        # Last branch gone: the index written a moment ago must be removed, not
        # left pointing into a directory that no longer exists.
        dirs("feat-a")
        reconcile(d, ["feat/a"], "o", "r", latest="feat/a")
        assert os.path.exists(os.path.join(d, "index.html")), "fixture wrote no index"
        kept3, _ = reconcile(d, ["main"], "o", "r")
        assert kept3 == []
        assert not os.path.exists(os.path.join(d, "index.html")), "stale index survived"

    print("sync-previews selftest: ok")


def main():
    if "--selftest" in sys.argv:
        return selftest()

    preview_dir, branches_file, owner, repo = sys.argv[1:5]
    latest = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None

    with open(branches_file) as f:
        live = [ln.strip() for ln in f if ln.strip()]
    if not live:
        # ls-remote came back empty: a network blip, not "every branch is
        # gone". Deleting every preview on that reading is unrecoverable.
        sys.exit("refusing to reconcile against an empty branch list")

    os.makedirs(preview_dir, exist_ok=True)
    kept, removed = reconcile(preview_dir, live, owner, repo, latest)
    for r in removed:
        print("removed orphaned preview: %s" % r)
    print("previews live: %s" % (", ".join(kept) or "none"))


if __name__ == "__main__":
    main()
