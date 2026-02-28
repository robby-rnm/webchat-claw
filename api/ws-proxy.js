import os from 'os';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// PostgreSQL connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: '1',
  database: 'aclaw',
});

const app = express();
app.use(express.json());

// CORS support
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-Admin-Key");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const PORT = process.env.PORT || 8084;
const GATEWAY_WS = process.env.GATEWAY_WS || 'ws://127.0.0.1:18789/gateway/v1/ws';
const PROXY_TOKEN = process.env.PROXY_TOKEN || 'change-me-in-production';
const API_KEY = process.env.API_KEY || 'f05a64a1178741eab1209d285d207f830a883bd2322f6914';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin_secret';

// In-memory store for active proxy connections
const activeConnections = new Map();

function generateRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}
// ============================================
// PRIORITY 1 SECURITY FUNCTIONS
// ============================================

// Input Sanitization (Prompt Injection Prevention)
function sanitizeInput(text) {
  if (!text) return text;
  // Strip common prompt injection patterns
  return text
    .replace(/^(system|assistant|user|ignore|disregard)[:\s]/gi, '')
    .replace(/ignore\s+(all\s+)?(previous\s+)?instructions/gi, '')
    .replace(/you\s+are\s+(now\s+)?/gi, '')
    .replace(/<\|/g, '')  // Remove LLM special tokens
    .replace(/\|>/g, '')
    .trim();
}

// XSS Prevention (Output Encoding)
function escapeHtml(text) {
  const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Rate Limiting
const rateLimits = new Map();
function checkRateLimit(clientId, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const key = clientId;
  if (!rateLimits.has(key)) rateLimits.set(key, []);
  const requests = rateLimits.get(key).filter(t => now - t < windowMs);
  if (requests.length >= maxRequests) return false;
  requests.push(now);
  rateLimits.set(key, requests);
  return true;
}

// ============================================



// Login function - verify username/password against PostgreSQL
async function verifyLogin(username, password) {
  try {
    const result = await pool.query(
      'SELECT password FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return { valid: false, error: 'User not found' };
    }
    
    const hash = result.rows[0].password;
    const match = await bcrypt.compare(password, hash);
    
    if (match) {
      return { valid: true, username };
    } else {
      return { valid: false, error: 'Invalid password' };
    }
  } catch (e) {
    console.error('Login error:', e);
    return { valid: false, error: 'Database error' };
  }
}

// Auth middleware for WebSocket
function authenticateClient(url, host) {
  try {
    // Handle relative URLs (ws://host/path?query)
    let urlStr = url;
    if (!url.startsWith('ws://') && !url.startsWith('http')) {
      urlStr = `ws://${host}${url}`;
    }
    
    const urlObj = new URL(urlStr);
    const token = urlObj.searchParams.get('token');
    const loginUser = urlObj.searchParams.get('user');
    const loginPass = urlObj.searchParams.get('pass');
    
    // If login credentials provided, use database auth
    if (loginUser && loginPass) {
      return { 
        valid: 'pending', 
        loginUser, 
        loginPass,
        isLogin: true 
      };
    }
    
    // Otherwise, use token auth
    if (!token) {
      return { valid: false, error: 'Missing token or credentials' };
    }
    
    if (token !== PROXY_TOKEN) {
      return { valid: false, error: 'Invalid token' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid URL' };
  }
}

// Create upstream Gateway connection
function createGatewayConnection(clientId, origin = 'http://localhost:3000', username = null) {
  return new Promise((resolve, reject) => {
    const gatewayUrl = `${GATEWAY_WS}?token=${API_KEY}`;
    const ws = new WebSocket(gatewayUrl, {
      headers: {
        'Origin': origin
      }
    });
    
    let resolved = false;
    // Use username for unique session key, or generate random one
    const sessionKeyPrefix = username ? `web-${username}` : `proxy-${clientId}`;
    let sessionKey = null;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
      }
    };
    
    const timeout = setTimeout(() => {
      // Keep connection alive, don't reject on timeout
      console.log(`[${clientId}] Gateway idle timeout (keeping connection)`);
    }, 60000);
    
    ws.on('open', () => {
      console.log(`[${clientId}] Connected to Gateway, sending connect request...`);
      
      const connectMsg = {
        type: 'req',
        method: 'connect',
        id: generateRequestId(),
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'openclaw-control-ui',
            displayName: 'AClaw WebChat',
            version: '1.0.0',
            platform: 'web',
            mode: 'ui',
          },
          caps: [],
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          auth: {
            token: API_KEY,
          },
        },
      };
      
      console.log(`[${clientId}] Connect msg:`, JSON.stringify(connectMsg));
      ws.send(JSON.stringify(connectMsg));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[${clientId}] Gateway msg:`, JSON.stringify(msg).substring(0, 200));
        
        // Check for connect response - use id to match the connect request
        if (msg.type === 'res' && msg.ok && msg.id && msg.id.startsWith('req_')) {
          clearTimeout(timeout);
          resolved = true;
          // Gateway returns payload, not result
          sessionKey = msg.payload?.sessionKey || sessionKeyPrefix;
          console.log(`[${clientId}] Gateway session: ${sessionKey}, resolving...`);
          resolve({ ws, sessionKey });
          console.log(`[${clientId}] Promise resolved!`);
        }
        
        // Handle connect error
        if (msg.type === 'res' && msg.method === 'connect' && !msg.ok) {
          console.log(`[${clientId}] Connect error:`, msg.error?.message);
          clearTimeout(timeout);
          cleanup();
          reject(new Error(msg.error?.message || 'Gateway connection failed'));
        }
      } catch (e) {
        console.error(`[${clientId}] Parse error:`, e);
      }
    });
    
    ws.on('error', (err) => {
      console.error(`[${clientId}] Gateway error:`, err.message);
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });
    
    ws.on('close', () => {
      console.log(`[${clientId}] Gateway disconnected`);
    });
  });
}

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const clientId = crypto.randomBytes(4).toString('hex');
  const clientIp = req.socket.remoteAddress;
  const origin = req.headers.origin || req.headers.referer || 'http://localhost:3000';
  let clientUsername = null; // For logged-in users
  
  console.log(`[${clientId}] New connection from ${clientIp}, origin: ${origin}`);
  
  // Authenticate - get host from request headers
  const host = req.headers.host || 'localhost';
  const auth = authenticateClient(req.url, host);
  
  // Handle login authentication
  if (auth.isLogin) {
    console.log(`[${clientId}] Login attempt for user: ${auth.loginUser}`);
    const loginResult = await verifyLogin(auth.loginUser, auth.loginPass);
    
    if (!loginResult.valid) {
      console.log(`[${clientId}] Login failed: ${loginResult.error}`);
      ws.close(4001, loginResult.error);
      return;
    }
    
    // Store logged-in username for this connection
    clientUsername = loginResult.username;
    console.log(`[${clientId}] Login OK for user: ${clientUsername}`);
  } else if (!auth.valid) {
    console.log(`[${clientId}] Auth failed: ${auth.error}`);
    ws.close(4001, auth.error);
    return;
  }
  
  // Rate limiting check
  if (!checkRateLimit(clientId)) {
    console.log(`[${clientId}] Rate limit exceeded`);
    ws.close(4003, 'Rate limit exceeded');
    return;
  }
  
  console.log(`[${clientId}] Auth OK, connecting to Gateway...`);
  
  // Connect to Gateway with username for unique session
  createGatewayConnection(clientId, origin, clientUsername)
    .then(({ ws: gatewayWs, sessionKey }) => {
      console.log(`[${clientId}] Proxy ready, session: ${sessionKey}`);
      
      // Send ready message to client
      ws.send(JSON.stringify({
        type: 'res',
        method: 'connect',
        id: 'proxy-ready',
        ok: true,
        payload: { sessionKey, proxyVersion: '1.0.0' }
      }));
      
      console.log(`[${clientId}] Sent ready to client`);
      
      // Store connection
      const connection = {
        clientWs: ws,
        gatewayWs,
        sessionKey,
        clientId,
      };
      activeConnections.set(clientId, connection);
      
      // Forward: Client → Gateway
      ws.on('message', (data) => {
        console.log(`[${clientId}] 📥 Client → Gateway:`, data.toString().substring(0, 150));
        try {
          const msg = JSON.parse(data.toString());
          
          // Block connect request from frontend - proxy already connected to Gateway
          if (msg.type === 'req' && msg.method === 'connect') {
            console.log(`[${clientId}] Blocking frontend connect request - using proxy's Gateway connection`);
            ws.send(JSON.stringify({
              type: 'res',
              method: 'connect',
              id: msg.id,
              ok: true,
              payload: { sessionKey, proxyVersion: '1.0.0' }
            }));
            return;
          }
          
          // Inject sessionKey from Gateway connection
          if (msg.type === 'req' && msg.params) {
            // Add sessionKey if not present
            if (!msg.params.sessionKey) {
              msg.params.sessionKey = sessionKey;
            }
            // Add idempotencyKey for chat.send if not present
            if (msg.method === 'chat.send' && !msg.params.idempotencyKey) {
              msg.params.idempotencyKey = 'idem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }
            // Save message to database (fire and forget)
            if (msg.method === 'chat.send' && msg.params.content) {
              getUserId(clientUsername).then(userId => {
                saveMessage(userId, clientUsername || 'anonymous', msg.params.content, sessionKey);
              });
            }
          }
          
          // Add request ID if missing
          if (msg.type === 'req' && !msg.id) {
            msg.id = generateRequestId();
          }
          
          // Input sanitization: sanitize string params to prevent prompt injection
          if (msg.params) {
            for (const [key, value] of Object.entries(msg.params)) {
              if (typeof value === 'string') {
                msg.params[key] = sanitizeInput(value);
              }
            }
          }
          
          gatewayWs.send(JSON.stringify(msg));
        } catch (e) {
          console.error(`[${clientId}] Forward error:`, e);
        }
      });
      
      // Forward: Gateway → Client (filter by sessionKey)
      gatewayWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Get sessionKey from different response formats
          const msgSessionKey = msg.payload?.sessionKey || msg.result?.sessionKey;
          
          // Filter: ONLY forward messages for this user's session
          if (msgSessionKey) {
            // Skip Telegram group messages
            if (msgSessionKey.includes('telegram:group')) {
              return;
            }
            // Skip main session
            if (msgSessionKey === 'agent:main:main') {
              return;
            }
            // Skip if doesn't match this user's session
            // Our session could be: web-{username} or proxy-{clientId}
            // Gateway might prefix with "agent:main:"
            const userSession = sessionKey; // This connection's session
            const userIdentifier = userSession.replace('web-', '').replace('proxy-', '');
            
            // Check if msgSessionKey contains our identifier
            const isOurSession = msgSessionKey.includes('agent:main:' + userSession) || 
                               msgSessionKey === userSession ||
                               msgSessionKey.includes(userIdentifier);
            
            if (!isOurSession) {
              console.log(`[${clientId}] Skipping: ${msgSessionKey} (our: ${userSession})`);
              return;
            }
          }
          
          // Forward only messages for this session
          // XSS prevention: escape HTML in message content before sending to client
          if (msg.payload?.content) {
            if (typeof msg.payload.content === 'string') {
              msg.payload.content = escapeHtml(msg.payload.content);
            }
          }
          if (msg.result?.content) {
            if (typeof msg.result.content === 'string') {
              msg.result.content = escapeHtml(msg.result.content);
            }
          }
          ws.send(JSON.stringify(msg));
        } catch (e) {
          console.error(`[${clientId}] Forward error (gateway→client):`, e);
        }
      });
      
      // Handle client disconnect
      ws.on('close', () => {
        console.log(`[${clientId}] Client disconnected`);
        activeConnections.delete(clientId);
        gatewayWs.close();
      });
      
      // Handle gateway disconnect
      gatewayWs.on('close', () => {
        console.log(`[${clientId}] Gateway disconnected, closing client`);
        activeConnections.delete(clientId);
        ws.close();
      });
      
      // Send ready signal to client
      ws.send(JSON.stringify({
        type: 'res',
        method: 'connect',
        id: 'proxy-connect',
        ok: true,
        result: {
          sessionKey,
          proxyVersion: '1.0.0',
        },
      }));
    })
    .catch((err) => {
      console.error(`[${clientId}] Gateway connection failed:`, err.message);
      ws.close(4002, err.message);
    });
});

// Save message to PostgreSQL
async function saveMessage(userId, username, content, sessionKey) {
  try {
    await pool.query(
      'INSERT INTO messages (user_id, username, content, session_key) VALUES ($1, $2, $3, $4)',
      [userId, username, content, sessionKey]
    );
  } catch (e) {
    console.error('Failed to save message:', e);
  }
}

// Get user ID by username
async function getUserId(username) {
  try {
    const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    return result.rows.length > 0 ? result.rows[0].id : null;
  } catch (e) {
    console.error('Failed to get user ID:', e);
    return null;
  }
}

// Get messages for a session
app.get('/api/messages', async (req, res) => {
  const { session, limit = 50 } = req.query;
  
  if (!session) {
    return res.status(400).json({ error: 'Missing session parameter' });
  }
  
  try {
    const result = await pool.query(
      'SELECT id, user_id, username, content, session_key, created_at FROM messages WHERE session_key = $1 ORDER BY created_at DESC LIMIT $2',
      [session, Math.min(limit, 100)]
    );
    res.json({ messages: result.rows.reverse() });
  } catch (e) {
    console.error('Failed to get messages:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    connections: activeConnections.size,
  });
});


// Admin middleware - check X-Admin-Key header
function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

// POST /api/admin/users - Create new user (admin only)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    // Hash password and create user
    const hash = await bcrypt.hash(password, 10);
    const isAdmin = role === 'admin';
    
    const result = await pool.query(
      'INSERT INTO users (username, password, role, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, username, role, is_admin, created_at',
      [username, hash, role, isAdmin]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('Create user error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users - List all users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, is_admin, created_at FROM users ORDER BY id'
    );
    res.json({ users: result.rows });
  } catch (e) {
    console.error('List users error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id - Delete a user (admin only)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (e) {
    console.error('Delete user error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get active connections info
app.get('/connections', (req, res) => {
  const list = Array.from(activeConnections.values()).map(c => ({
    clientId: c.clientId,
    sessionKey: c.sessionKey,
  }));
  res.json({ connections: list });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  const host = os.networkInterfaces().eth0?.[0]?.address || 
               os.networkInterfaces().en0?.[0]?.address || 
               'localhost';
  
  console.log(`
🟢 AClaw WebSocket Proxy
   Port:     ${PORT}
   Local:    ws://localhost:${PORT}/?token=${PROXY_TOKEN}
   Network:  ws://${host}:${PORT}/?token=${PROXY_TOKEN}
   
   Gateway:  ${GATEWAY_WS}
  `);
});
