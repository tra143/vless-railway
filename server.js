const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { createHash } = require('crypto');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const UUID       = process.env.UUID  || generateUUID();
const WS_PATH    = process.env.WS_PATH || '/' + randomHex(8);
const XRAY_ARCH  = getArch();
const XRAY_DIR   = path.join(__dirname, 'bin');
const XRAY_BIN   = path.join(XRAY_DIR, 'xray');
const XRAY_VER   = '1.8.24';

// ─── HELPERS ───────────────────────────────────────────────────────────────
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function randomHex(len) {
  let s = '';
  while (s.length < len) s += Math.random().toString(16).slice(2);
  return s.slice(0, len);
}

function getArch() {
  const a = process.arch;
  if (a === 'x64')   return 'linux-64';
  if (a === 'arm64') return 'linux-arm64-v8a';
  return 'linux-64';
}

// ─── DOWNLOAD XRAY ─────────────────────────────────────────────────────────
async function downloadXray() {
  if (fs.existsSync(XRAY_BIN)) {
    console.log('[xray] binary already exists, skipping download');
    return;
  }
  fs.mkdirSync(XRAY_DIR, { recursive: true });

  const filename = `Xray-${XRAY_ARCH}.zip`;
  const url = `https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VER}/${filename}`;
  const zipPath = path.join(XRAY_DIR, filename);

  console.log(`[xray] downloading from ${url}`);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    https.get(url, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location, res2 => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });

  console.log('[xray] extracting...');
  execSync(`cd "${XRAY_DIR}" && unzip -o "${filename}" xray && chmod +x xray && rm "${filename}"`);
  console.log('[xray] ready at', XRAY_BIN);
}

// ─── XRAY CONFIG ───────────────────────────────────────────────────────────
function buildXrayConfig(inboundPort) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [{
      port: inboundPort,
      listen: '127.0.0.1',
      protocol: 'vless',
      settings: {
        clients: [{ id: UUID, level: 0 }],
        decryption: 'none'
      },
      streamSettings: {
        network: 'ws',
        wsSettings: { path: WS_PATH }
      }
    }],
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'blocked' }
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        {
          type: 'field',
          ip: [
            '0.0.0.0/8','10.0.0.0/8','100.64.0.0/10',
            '127.0.0.0/8','169.254.0.0/16','172.16.0.0/12',
            '192.0.0.0/24','192.168.0.0/16','198.18.0.0/15',
            '198.51.100.0/24','203.0.113.0/24','::1/128','fc00::/7','fe80::/10'
          ],
          outboundTag: 'blocked'
        }
      ]
    }
  };
}

// ─── PROXY WS → XRAY ───────────────────────────────────────────────────────
let xrayPort = 10808;

function setupWebSocketProxy(httpServer) {
  const net = require('net');
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== WS_PATH) {
      socket.destroy();
      return;
    }
    // Connect to local xray WS port
    const upstream = net.connect(xrayPort, '127.0.0.1', () => {
      // Forward upgrade request
      let rawHead = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        rawHead += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`;
      }
      rawHead += '\r\n';
      upstream.write(rawHead);
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
}

// ─── HTML DASHBOARD ────────────────────────────────────────────────────────
function buildDashboard(host) {
  const vlessLink = `vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=${encodeURIComponent(WS_PATH)}#Railway-VLESS`;
  const qrAPI    = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(vlessLink)}`;

  const clientConf = JSON.stringify({
    v:    '2',
    ps:   'Railway-VLESS',
    add:  host,
    port: '443',
    id:   UUID,
    aid:  '0',
    scy:  'none',
    net:  'ws',
    type: 'none',
    host: host,
    path: WS_PATH,
    tls:  'tls',
    sni:  host,
    alpn: ''
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VLESS Node — Railway</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
  :root{
    --bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;
    --accent:#7c6af7;--accent2:#4fd1c5;--text:#e2e2f0;--muted:#6b6b8a;
    --green:#22c55e;--red:#f43f5e;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;min-height:100vh;
    background-image:radial-gradient(ellipse 80% 60% at 50% -20%,rgba(124,106,247,.18),transparent);
  }
  .noise{position:fixed;inset:0;pointer-events:none;opacity:.03;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size:256px;z-index:999;
  }
  header{padding:2rem 2rem 0;display:flex;align-items:center;gap:.75rem}
  .logo{width:36px;height:36px;background:linear-gradient(135deg,var(--accent),var(--accent2));
    border-radius:10px;display:grid;place-items:center;font-size:1.1rem;font-weight:800;color:#fff;
    box-shadow:0 0 24px rgba(124,106,247,.4);}
  header h1{font-size:1.05rem;font-weight:700;letter-spacing:-.01em}
  header small{color:var(--muted);font-size:.78rem;font-family:'JetBrains Mono',monospace}
  .status{margin-left:auto;display:flex;align-items:center;gap:.4rem;
    background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);
    padding:.3rem .75rem;border-radius:99px;font-size:.78rem;color:var(--green)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--green);
    box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

  main{max-width:900px;margin:0 auto;padding:2rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
    padding:1.5rem;position:relative;overflow:hidden}
  .card::before{content:'';position:absolute;inset:0;opacity:0;
    background:radial-gradient(400px at var(--mx,50%) var(--my,50%),rgba(124,106,247,.06),transparent 70%);
    transition:opacity .3s;pointer-events:none}
  .card:hover::before{opacity:1}
  .card-label{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;
    color:var(--muted);margin-bottom:.6rem;font-family:'JetBrains Mono',monospace}
  .card-value{font-size:.9rem;font-family:'JetBrains Mono',monospace;
    color:var(--text);word-break:break-all;line-height:1.5}
  .card-value.mono-lg{font-size:.82rem;color:var(--accent2)}

  .link-card{grid-column:1/-1}
  .link-box{background:rgba(124,106,247,.07);border:1px solid rgba(124,106,247,.2);
    border-radius:10px;padding:1rem;font-family:'JetBrains Mono',monospace;
    font-size:.78rem;line-height:1.6;color:var(--accent);word-break:break-all;
    cursor:pointer;transition:background .2s}
  .link-box:hover{background:rgba(124,106,247,.14)}

  .btn-row{display:flex;gap:.75rem;margin-top:1rem;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:.45rem;padding:.55rem 1.1rem;
    border-radius:8px;font-size:.82rem;font-weight:700;font-family:'Syne',sans-serif;
    border:none;cursor:pointer;transition:all .2s;letter-spacing:.01em}
  .btn-primary{background:var(--accent);color:#fff;box-shadow:0 4px 20px rgba(124,106,247,.35)}
  .btn-primary:hover{background:#6a58e5;transform:translateY(-1px)}
  .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
  .btn-ghost:hover{color:var(--text);border-color:var(--muted)}

  .qr-card{display:flex;flex-direction:column;align-items:center;gap:1rem}
  .qr-card img{border-radius:12px;border:3px solid var(--border);
    background:#fff;padding:8px;width:200px;height:200px}

  .json-block{background:#0d0d14;border:1px solid var(--border);border-radius:10px;
    padding:1rem;font-family:'JetBrains Mono',monospace;font-size:.74rem;
    color:#a5b4fc;line-height:1.7;overflow-x:auto;white-space:pre;max-height:260px;overflow-y:auto}

  footer{text-align:center;padding:2rem;color:var(--muted);font-size:.78rem;
    font-family:'JetBrains Mono',monospace}

  .toast{position:fixed;bottom:2rem;right:2rem;background:var(--green);color:#000;
    font-weight:700;padding:.65rem 1.25rem;border-radius:10px;font-size:.85rem;
    transform:translateY(100px);opacity:0;transition:all .3s;z-index:1000}
  .toast.show{transform:translateY(0);opacity:1}

  .section-title{font-size:1.15rem;font-weight:800;margin:2rem 0 1rem;
    letter-spacing:-.02em;display:flex;align-items:center;gap:.5rem}
  .section-title::after{content:'';flex:1;height:1px;background:var(--border)}
  .badge{background:rgba(79,209,197,.12);color:var(--accent2);font-size:.7rem;
    padding:.2rem .55rem;border-radius:99px;font-weight:700;font-family:'JetBrains Mono',monospace}
</style>
</head>
<body>
<div class="noise"></div>

<header>
  <div class="logo">V</div>
  <div>
    <h1>VLESS Node</h1>
    <small>Railway Cloud · Xray Core v${XRAY_VER}</small>
  </div>
  <div class="status"><span class="dot"></span> Active</div>
</header>

<main>
  <p class="section-title">Connection Details <span class="badge">VLESS+WS+TLS</span></p>

  <div class="grid">
    <div class="card">
      <div class="card-label">Server</div>
      <div class="card-value">${host}</div>
    </div>
    <div class="card">
      <div class="card-label">Port</div>
      <div class="card-value">443</div>
    </div>
    <div class="card">
      <div class="card-label">UUID</div>
      <div class="card-value mono-lg" id="uuid">${UUID}</div>
    </div>
    <div class="card">
      <div class="card-label">WebSocket Path</div>
      <div class="card-value mono-lg">${WS_PATH}</div>
    </div>
    <div class="card">
      <div class="card-label">Transport</div>
      <div class="card-value">WebSocket (ws)</div>
    </div>
    <div class="card">
      <div class="card-label">TLS / Security</div>
      <div class="card-value">TLS ✓ &nbsp;·&nbsp; Encryption: none</div>
    </div>

    <div class="card link-card">
      <div class="card-label">VLESS Link — click to copy</div>
      <div class="link-box" id="vlessLink" onclick="copyLink()">${vlessLink}</div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="copyLink()">⎘ Copy Link</button>
        <button class="btn btn-ghost" onclick="copyJSON()">{ } Copy v2rayN JSON</button>
      </div>
    </div>

    <div class="card qr-card">
      <div class="card-label" style="align-self:flex-start;width:100%">QR Code</div>
      <img src="${qrAPI}" alt="QR Code" loading="lazy">
      <small style="color:var(--muted);font-size:.72rem;font-family:monospace">Scan with v2rayNG / NekoBox</small>
    </div>

    <div class="card">
      <div class="card-label">v2rayN / v2rayNG JSON Config</div>
      <div class="json-block" id="jsonConf">${clientConf.replace(/</g,'&lt;')}</div>
    </div>
  </div>

  <p class="section-title">Supported Clients</p>
  <div class="grid">
    ${[
      ['v2rayNG','Android','https://github.com/2dust/v2rayNG/releases'],
      ['NekoBox','Android','https://github.com/MatsuriDayo/NekoBoxForAndroid/releases'],
      ['v2rayN','Windows','https://github.com/2dust/v2rayN/releases'],
      ['Hiddify','Multi-platform','https://github.com/hiddify/hiddify-app/releases'],
      ['Shadowrocket','iOS','https://apps.apple.com/app/id932747118'],
      ['Streisand','iOS/macOS','https://apps.apple.com/app/id6450534064'],
    ].map(([n,p,u])=>`
    <div class="card" style="padding:1rem 1.25rem">
      <div class="card-label">${p}</div>
      <div class="card-value"><a href="${u}" target="_blank" style="color:var(--accent);text-decoration:none">${n} ↗</a></div>
    </div>`).join('')}
  </div>
</main>

<footer>© ${new Date().getFullYear()} · Self-hosted on Railway · Xray-core VLESS over WebSocket+TLS</footer>

<div class="toast" id="toast">Copied!</div>

<script>
const VLESS = ${JSON.stringify(vlessLink)};
const JSON_CONF = ${JSON.stringify(clientConf)};

function copyLink(){
  navigator.clipboard.writeText(VLESS).then(()=>showToast('VLESS link copied!'));
}
function copyJSON(){
  navigator.clipboard.writeText(JSON_CONF).then(()=>showToast('JSON config copied!'));
}
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

// Card spotlight effect
document.querySelectorAll('.card').forEach(card=>{
  card.addEventListener('mousemove',e=>{
    const r=card.getBoundingClientRect();
    card.style.setProperty('--mx',(e.clientX-r.left)+'px');
    card.style.setProperty('--my',(e.clientY-r.top)+'px');
  });
});
</script>
</body>
</html>`;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('[boot] UUID      =', UUID);
  console.log('[boot] WS_PATH   =', WS_PATH);
  console.log('[boot] Port      =', PORT);
  console.log('[boot] Arch      =', XRAY_ARCH);

  try {
    await downloadXray();

    // Write xray config
    const configPath = path.join(XRAY_DIR, 'config.json');
    const cfg = buildXrayConfig(xrayPort);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    // Start xray
    const xray = spawn(XRAY_BIN, ['run', '-c', configPath], { stdio: 'inherit' });
    xray.on('error', err => console.error('[xray] error:', err));
    xray.on('exit', code => console.warn('[xray] exited with code', code));
    console.log('[xray] started on port', xrayPort);
  } catch (err) {
    console.error('[xray] failed to start:', err.message);
    console.warn('[warn] dashboard will still serve, but proxy is inactive');
  }

  // HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const html = buildDashboard(host);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  setupWebSocketProxy(server);

  server.listen(PORT, () => {
    console.log(`[http] listening on :${PORT}`);
  });
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
