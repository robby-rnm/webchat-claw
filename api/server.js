import express from 'express';
import { WebSocket } from 'ws';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789/gateway/v1/ws';
const API_KEY = process.env.API_KEY || 'f05a64a1178741eab1209d285d207f830a883bd2322f6914';

// In-memory store for active connections
const connections = new Map();

function generateId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Create a new session connection
function createSession(sessionLabel = 'api-client') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL + '?token=' + API_KEY);
    let resolved = false;
    let sessionKey = `${sessionLabel}_${Date.now()}`;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
      }
    };
    
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Connection timeout'));
    }, 10000);
    
    ws.on('open', () => {
      // Send connect request
      ws.send(JSON.stringify({
        type: 'req',
        method: 'connect',
        id: generateId(),
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'openclaw-control-ui',
            displayName: 'AClaw API',
            version: '1.0.0',
            platform: 'web',
            mode: 'ui',
          },
          caps: [],
          role: 'operator',
          scopes: ['operator.read', 'operator.write', 'operator.admin'],
          auth: {
            token: API_KEY,
          },
        },
      }));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Check if connected
        if (msg.type === 'res' && msg.ok) {
          clearTimeout(timeout);
          resolved = true;
          resolve({ ws, sessionKey });
        }
        
        // Handle errors
        if (msg.type === 'res' && !msg.ok) {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(msg.error?.message || 'Connection failed'));
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });
  });
}

// Send message and wait for response
async function sendMessage(session, message) {
  return new Promise((resolve, reject) => {
    const { ws, sessionKey } = session;
    const id = generateId();
    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    let responseText = '';
    let done = false;
    
    const timeout = setTimeout(() => {
      done = true;
      ws.close();
      reject(new Error('Response timeout'));
    }, 60000);
    
    const cleanup = () => {
      clearTimeout(timeout);
      done = true;
    };
    
    ws.on('message', (data) => {
      if (done) return;
      
      try {
        const msg = JSON.parse(data.toString());
        
        // Listen for agent responses for our session
        if (msg.event === 'agent' && msg.payload?.sessionKey?.includes(sessionKey.split('_')[0])) {
          if (msg.payload.stream === 'assistant') {
            const text = msg.payload.data?.text || msg.payload.data?.delta;
            if (text) {
              responseText = text;
            }
          }
          
          // Check if done
          if (msg.payload.stream === 'lifecycle' && msg.payload.data?.phase === 'end') {
            cleanup();
            resolve({ response: responseText });
          }
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    });
    
    // Send the message
    ws.send(JSON.stringify({
      type: 'req',
      method: 'chat.send',
      id,
      params: {
        sessionKey,
        message,
        idempotencyKey,
      },
    }));
  });
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Send chat message
app.post('/chat', async (req, res) => {
  const { message, sessionLabel } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  
  try {
    console.log('Creating session...');
    const session = await createSession(sessionLabel);
    
    console.log('Sending message:', message);
    const result = await sendMessage(session, message);
    
    // Close connection
    session.ws.close();
    
    res.json(result);
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get session history
app.get('/sessions', async (req, res) => {
  // For now, just return a simple response
  res.json({ 
    sessions: [] 
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🟢 AClaw API Server
   Local:   http://localhost:${PORT}
   Network: http://$(hostname -I | awk '{print $1}'):${PORT}
   
   Endpoints:
   POST /chat    - Send a message
   GET  /health  - Health check
  `);
});
