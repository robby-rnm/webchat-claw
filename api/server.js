import express from 'express';
import { WebSocket } from 'ws';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow images and common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp3|mp4|wav|ogg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/');
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('File type not allowed'));
  }
});

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

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const fileUrl = `/uploads/${req.file.filename}`;
  const isImage = req.file.mimetype.startsWith('image/');
  
  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: fileUrl,
      isImage: isImage
    }
  });
});

// Upload error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 10MB allowed.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
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
   POST /upload  - Upload a file
   GET  /health  - Health check
  `);
});
