#!/usr/bin/env python3
"""
build-signing.py
================
Builds index.html from signing.html, auto-repairing the common
truncation issue caused by VS Code / OneDrive linters chopping
the closing tags off the file.

Usage:
    python build-signing.py
"""

import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, 'signing.html')
OUT  = os.path.join(HERE, 'index.html')

TAIL = b"""\
.display='none'; }
function esc(s)   { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showErr(title, msg) {
  hide('loading-screen');
  g('err-title').textContent=title; g('err-body').innerHTML=msg;
  g('top-badge').textContent='LINK ERROR'; g('top-badge').style.background='#c0392b';
  g('error-screen').style.display='flex';
}
</script>
</body>
</html>
"""

def build():
    if not os.path.exists(SRC):
        print(f"ERROR: {SRC} not found")
        sys.exit(1)

    data = open(SRC, 'rb').read()
    original_size = len(data)

    # Check if file is truncated (missing </script>)
    if b'</script>' not in data.lower():
        print(f"WARNING: signing.html is truncated ({original_size} bytes) — appending standard tail")
        # Strip any partial tail that may exist to avoid duplication
        # Find where the truncation likely starts (after last complete function closing brace)
        # Safe anchor: everything before the hide() partial line
        anchors = [
            b"function hide(id) { document.getElementById(id).style",
            b"function esc(s)",
            b"function showErr(",
            b"function g(id)",
        ]
        cut_at = -1
        for anchor in anchors:
            idx = data.rfind(anchor)
            if idx != -1:
                cut_at = idx
                break

        if cut_at != -1:
            data = data[:cut_at]
        data = data + TAIL
        print(f"Repaired: {original_size} → {len(data)} bytes")
    else:
        print(f"signing.html OK ({original_size} bytes)")

    # Validate JS syntax via node if available
    try:
        import subprocess, tempfile
        html = data.decode('utf-8', errors='replace')
        script_start = html.index('<script>') + 8
        script_end   = html.rindex('<' + '/script>')
        js = html[script_start:script_end]
        tmp = tempfile.NamedTemporaryFile(suffix='.js', delete=False, mode='w', encoding='utf-8')
        tmp.write(js); tmp.close()
        result = subprocess.run(['node', '--check', tmp.name], capture_output=True, text=True)
        os.unlink(tmp.name)
        if result.returncode != 0:
            print(f"JS SYNTAX ERROR:\n{result.stderr}")
            sys.exit(1)
        print("JS syntax: OK")
    except (ValueError, FileNotFoundError):
        print("JS syntax check skipped (node not found or no <script> block)")

    open(OUT, 'wb').write(data)
    print(f"Written: {OUT}  ({len(data)} bytes)")
    print("Upload index.html to Netlify to deploy.")

if __name__ == '__main__':
    build()
