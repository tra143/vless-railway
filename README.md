# VLESS Node on Railway

A lightweight VLESS proxy server running **Xray-core** over **WebSocket + TLS**, deployable in one click on [Railway](https://railway.app).

## ✨ Features

- **VLESS + WS + TLS** — the most compatible combo for bypassing restrictions
- **Auto-downloads Xray-core** on first boot (no binary committed to repo)
- **Beautiful dashboard** at your Railway URL showing your config + QR code
- **Zero dependencies** — pure Node.js, no npm install needed
- Works with **v2rayNG, NekoBox, Hiddify, v2rayN, Shadowrocket**, and more

## 🚀 Deploy to Railway

### Option A — GitHub → Railway (recommended)

1. Fork or push this repo to your GitHub account
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
3. Select your repo
4. Railway auto-detects `nixpacks.toml` and deploys

### Option B — Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### After Deploy

1. In Railway dashboard → your service → **Settings → Networking**
2. Click **Generate Domain** (get a free `*.up.railway.app` domain)
3. Visit that domain — you'll see your VLESS config dashboard

## ⚙️ Environment Variables (optional)

Set these in Railway → service → **Variables**:

| Variable   | Default          | Description                        |
|------------|------------------|------------------------------------|
| `UUID`     | auto-generated   | Your VLESS UUID (set manually for persistence) |
| `WS_PATH`  | random `/xxxxxxxx` | WebSocket path                   |
| `PORT`     | `3000`           | HTTP port (Railway sets this auto) |

> ⚠️ **Important**: Set `UUID` as a fixed env var so it doesn't change on each redeploy!

## 📱 Client Setup

### v2rayNG (Android) — easiest
1. Open v2rayNG → `+` → **Scan QR code**
2. Scan the QR on your dashboard

### Manual config
Use these values in any client:

| Field       | Value                            |
|-------------|----------------------------------|
| Protocol    | VLESS                            |
| Address     | `your-app.up.railway.app`        |
| Port        | `443`                            |
| UUID        | from dashboard                   |
| Encryption  | none                             |
| Transport   | WebSocket (ws)                   |
| Path        | from dashboard                   |
| TLS         | ✅ enabled                       |
| SNI         | `your-app.up.railway.app`        |

## 🔒 Security

- The WebSocket path is randomly generated — only you know it
- No logs stored
- Consider adding HTTP Basic Auth to the dashboard in production

## Architecture

```
Client → Railway HTTPS (443) → Node.js WS Proxy → Xray-core (127.0.0.1:10808)
                                    ↓
                             Dashboard UI (all other paths)
```

Railway terminates TLS, so Xray runs plain WS internally. The Node.js server proxies WebSocket upgrades to Xray and serves the HTML dashboard for normal HTTP requests.
