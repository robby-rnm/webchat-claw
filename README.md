# AClaw WebSocket Proxy

WebSocket proxy untuk OpenClaw Gateway dengan authentication.

## Requirements

- Node.js 18+
- PostgreSQL (untuk user authentication)
- OpenClaw Gateway running di port 18789

## Environment Variables

Copy `.env.example` ke `.env` dan sesuaikan:

```bash
# Server
PORT=8084
HOST=0.0.0.0

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=1
DB_NAME=aclaw

# OpenClaw Gateway
GATEWAY_WS=ws://127.0.0.1:18789/gateway/v1/ws

# ⚠️ PENTING: Get API_KEY dari Gateway
# Jalankan: openclaw config get apiKey
# Atau lihat di ~/.openclaw/config.json
GATEWAY_TOKEN=<YOUR_API_KEY>

# Proxy Authentication
PROXY_TOKEN=change-me-in-production

# Client Settings
CLIENT_ID=openclaw-control-ui
CLIENT_NAME=AClaw WebChat
CLIENT_VERSION=1.0.0
CLIENT_PLATFORM=web
CLIENT_MODE=ui
```

### Cara Mendapatkan GATEWAY_TOKEN

```bash
# Method 1: Dari config
openclaw config get apiKey

# Method 2: Dari config JSON
cat ~/.openclaw/config.json | grep apiKey
```

## Setup Database

```bash
# Login ke PostgreSQL
psql -U postgres

# Buat database
CREATE DATABASE aclaw;

# Buat users table
\c aclaw;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

# Buat user test (password: admin123)
INSERT INTO users (username, password) VALUES (
  'admin',
  '$2a$10$YourBcryptHashHere'
);

# Generate bcrypt hash untuk password:
# Node.js: const bcrypt = require('bcryptjs'); 
#          console.log(bcrypt.hashSync('admin123', 10));
```

## Menjalankan Proxy

```bash
cd /home/robby/Code/AClaw/api

# Install dependencies (jika belum)
npm install express ws pg bcryptjs dotenv

# Jalankan
node ws-proxy.js
```

## Web Server (Frontend)

```bash
cd /home/robby/Code/AClaw/web

# Install dependencies
npm install express

# Jalankan
node server.js
```

## Frontend Configuration

Edit `config.js`:

```javascript
const CONFIG = {
  wsUrl: 'ws://192.168.99.211:8084/',
  proxyToken: 'change-me-in-production',
};
```

## Akses

- **Web UI (Chat)**: http://192.168.99.211:3000
- **Admin Panel**: http://192.168.99.211:3000/admin.html
- **WebSocket Proxy**: ws://192.168.99.211:8084/

## Authentication

### Method 1: Token Auth
```
ws://192.168.99.211:8084/?token=change-me-in-production
```

### Method 2: Login (Username/Password)
```
ws://192.168.99.211:8084/?user=admin&pass=admin123
```

## Troubleshooting

### "device identity required"
Gateway wymengharpws device authentication. Ini kompleks - butuh publicKey + signature.

Solusi: Pakai cara lain untuk connect atau skip device auth di Gateway config.

### Login timeout
- Cek PostgreSQL connection
- Cek user credentials
- Cek proxy logs: `curl http://localhost:8084/health`

### Gateway disconnected
- Cek Gateway sedang running: `openclaw gateway status`
- Cek API_KEY benar

## Files

```
AClaw/
├── api/
│   ├── ws-proxy.js      # WebSocket Proxy
│   ├── server.js        # API Server (optional)
│   ├── .env.example     # Environment template
│   └── package.json
└── web/
    ├── index.html       # Chat UI
    ├── config.js        # Frontend config
    ├── server.js        # Web Server
    └── .env.example
```

## Admin Panel

**URL**: http://192.168.99.211:3000/admin.html

**Login**: Gunakan admin key: `admin_secret`

**Fitur**:
- Lihat daftar user
- Buat user baru
- Hapus user
