# AClient

Example client applications for connecting to **OpenClaw Gateway**.

This demonstrates how to build custom chat applications that connect to OpenClaw, allowing users to communicate with AI agents through your own interface.

## Quick Start

```bash
# Install dependencies
cd /home/robby/Code/AClaw
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your OpenClaw URL and API key
```

---

## Web Version (Recommended)

The easiest way to chat with your agent via a web browser.

```bash
cd /home/robby/Code/AClaw/web
npm start
```

Then open: **http://localhost:3000**

### Features:
- Beautiful dark-themed chat UI
- Real-time messaging via WebSocket
- Typing indicators
- Auto-reconnect
- Messages filtered to your session only

---

## CLI Version

### Interactive Mode
```bash
# Interactive chat
npm run ws interactive

# Type your message and press Enter
# Type "exit" to quit
```

### One-shot Messages
```bash
# Send a message via HTTP
npm run http send "Hello from my app!"

# Send a message via WebSocket
npm run ws send "Hello via WebSocket!"
```

---

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Your App   │────▶│ OpenClaw        │────▶│   Agent     │
│  (AClient)  │     │ Gateway         │     │  (AI/ML)    │
└─────────────┘     └─────────────────┘     └─────────────┘
      │                    │
      │    HTTP/WebSocket  │
      └────────────────────┘
```

---

## Two Connection Modes

### 1. HTTP (`src/http-client.js`)
- Simple request-response pattern
- Good for: chatbots, integrations, simple use cases
- One message = one HTTP request

### 2. WebSocket (`src/ws-client.js`)
- Real-time bidirectional communication
- Good for: interactive chat apps, streaming responses
- Persistent connection, instant responses

---

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `OPENCLAW_URL` | Gateway URL | `http://localhost:3000` |
| `OPENCLAW_API_KEY` | Authentication key | (required) |
| `SESSION_LABEL` | Session identifier | `my-app-client` |

### Getting an API Key

From OpenClaw status output, look for:
- **Auth token** (e.g., `robby-ThinkPad-X260`)

Or run:
```bash
openclaw status
```

---

## Available Methods

### HTTP Client
```javascript
import { HttpClient } from './src/http-client.js';

// Send a message
const response = await sendMessage("Hello!");

// List sessions
const sessions = await listSessions();

// Get session history
const history = await getSessionHistory(sessionKey);
```

### WebSocket Client
```javascript
import { AClientWebSocket } from './src/ws-client.js';

const client = new AClientWebSocket({
  url: 'http://localhost:18789',
  apiKey: 'f05a64a1178741eab1209d285d207f830a883bd2322f6914',
  sessionLabel: 'my-session'
});

await client.connect();

// Listen for agent responses
client.onMessage((msg) => {
  console.log('Agent:', msg.content?.text);
});

// Send a message
await client.send('Hello, agent!');
```

---

## Examples

### Build a simple CLI chat
```bash
npm run ws interactive
```

### Integrate with your existing backend
```javascript
// In your Express/Next.js app
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  const client = new AClientWebSocket({ apiKey: process.env.OPENCLAW_KEY });
  
  await client.connect();
  const response = await client.send(message);
  
  res.json(response);
});
```

---

## Project Structure

```
/home/robby/Code/AClaw/
├── web/                    # Web UI version
│   ├── index.html         # Chat interface
│   ├── server.js          # Express server
│   └── package.json
├── src/                   # CLI client library
│   ├── index.js           # Main exports
│   ├── http-client.js     # HTTP client
│   └── ws-client.js       # WebSocket client
├── package.json
├── README.md
└── .env.example
```

---

## License

MIT
# webchat-claw
# webchat-claw
# webchat-claw
