#!/usr/bin/env python3
"""Generate preview/index.html redirect page."""
import sys

def main():
    output_file = sys.argv[1]
    latest_safe = sys.argv[2]
    latest_branch = sys.argv[3]
    latest_commit = sys.argv[4]
    repo_owner = sys.argv[5]
    repo_name = sys.argv[6]
    
    html = f'''<!DOCTYPE html>
<meta charset="utf-8">
<title>HSK Chat Preview</title>
<meta http-equiv="refresh" content="0;url=./{latest_safe}/">
<meta name="robots" content="noindex">
<style>
  body{{background:#0f1317;color:#e8edf2;font:16px/1.5 system-ui,sans-serif;padding:40px}}
  .banner{{background:#2a343e;border:1px solid #5a4a22;border-radius:10px;padding:20px;margin-bottom:20px}}
  .warning{{color:#ffd479}}
  a{{color:#6aa9ff}}
  code{{background:#1a2026;padding:2px 6px;border-radius:4px}}
</style>
<div class="banner">
  <b class="warning">⚠ Preview Build</b> — This is a preview from a feature branch, not production.
  <div>Branch: <code>{latest_branch}</code></div>
  <div>Commit: <code>{latest_commit}</code></div>
  <p>Redirecting to preview... <a href="./{latest_safe}/">Click here if not redirected</a></p>
  <p><a href="./">View all previews</a> | <a href="https://{repo_owner}.github.io/{repo_name}/">Go to production</a></p>
</div>
'''
    
    with open(output_file, 'w') as f:
        f.write(html)

if __name__ == '__main__':
    main()
