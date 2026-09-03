// build-signing.js
// Builds index.html from signing.html, auto-repairing linter truncation.
// Usage: node build-signing.js

const fs   = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC  = path.join(HERE, 'signing.html');
const OUT  = path.join(HERE, 'index.html');

const TAIL = `\
.display='none'; }
function esc(s)   { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showErr(title, msg) {
  hide('loading-screen');
  g('err-title').textContent=title; g('err-body').innerHTML=msg;
  g('top-badge').textContent='LINK ERROR'; g('top-badge').style.background='#c0392b';
  g('error-screen').style.display='flex';
}
<\/script>
<\/body>
<\/html>
`;

if (!fs.existsSync(SRC)) {
  console.error('ERROR: signing.html not found at', SRC);
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const originalSize = html.length;

// Check for truncation
if (!html.includes('<' + '/script>')) {
  console.warn(`WARNING: signing.html is truncated (${originalSize} bytes) — appending standard tail`);

  // Trim any partial tail to avoid duplication
  const anchors = [
    'function hide(id) { document.getElementById(id).style',
    'function esc(s)',
    'function showErr(',
  ];
  for (const anchor of anchors) {
    const idx = html.lastIndexOf(anchor);
    if (idx !== -1) { html = html.slice(0, idx); break; }
  }

  html += TAIL;
  console.log(`Repaired: ${originalSize} → ${html.length} bytes`);
} else {
  console.log(`signing.html OK (${originalSize} bytes)`);
}

// Validate JS syntax
try {
  const scriptStart = html.indexOf('<script>') + 8;
  const scriptEnd   = html.lastIndexOf('<' + '/script>');
  const js = html.slice(scriptStart, scriptEnd);
  new Function(js);
  console.log('JS syntax: OK');
} catch (e) {
  console.error('JS SYNTAX ERROR:', e.message);
  process.exit(1);
}

fs.writeFileSync(OUT, html, 'utf8');
console.log(`Written: ${OUT}  (${html.length} bytes)`);
console.log('Upload index.html to Netlify to deploy.');
