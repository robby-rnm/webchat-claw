/**
 * AClient - WebSocket Client for OpenClaw Gateway
 * 
 * Real-time bidirectional communication with OpenClaw
 * Run: node src/ws-client.js
 */

import 'dotenv/config';
import WebSocket from 'ws';

const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://localhost:3000';
const API_KEY = process.env.OPENCLAW_API_KEY || '';
const SESSION_LABEL = process.env.SESSION_LABEL || 'ws-client-session';

// Extract host from URL
const getWsUrl = (httpUrl) => {
  const url = new URL(httpUrl);
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/gateway/v1/ws`;
};

class AClientWebSocket {
  constructor(options = {}) {
    this.url = options.url || getWsUrl(OPENCLAW_URL);
    this.apiKey = options.apiKey || API_KEY;
    this.sessionLabel = options.sessionLabel || SESSION_LABEL;
    this.ws = null;
    this.pendingRequests = new Map();
    this.messageHandler = null;
    this.eventHandler = null;
    this.sessionKey = null;
    this.requestId = 0;
  }

  /**
   * Generate a unique request ID
   */
  nextId() {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  /**
   * Generate a unique session key
   */
  generateSessionKey() {
    return `aclient_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a unique idempotency key
   */
  generateIdempotencyKey() {
    return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Connect to OpenClaw Gateway
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Origin': 'http://localhost:3000',
        },
      });

      this.ws.on('open', () => {
        console.log('✅ Connected to OpenClaw Gateway');
        // Immediately send connect request
        this.sendConnect().then(resolve).catch(reject);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 Disconnected from Gateway');
      });
    });
  }

  /**
   * Send connect request to initialize the session
   */
  async sendConnect() {
    const id = this.nextId();
    
    // Protocol version - must match gateway's version
    const PROTOCOL_VERSION = 3;
    
    const request = {
      type: 'req',
      method: 'connect',
      id,
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'openclaw-control-ui',  // Use Control UI client ID to enable device auth bypass
          displayName: 'AClient',
          version: '1.0.0',
          platform: 'web',  // Required field
          mode: 'ui',  // Use UI mode instead of webchat
        },
        caps: [],
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
        auth: {
          token: this.apiKey,
        },
      },
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Connect timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      
      // Handle responses to our requests
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id);
        this.pendingRequests.delete(msg.id);
        
        if (msg.error) {
          reject(new Error(msg.error.message || msg.error));
        } else {
          // For chat.send, the result might be empty but we should still resolve
          resolve(msg.result ?? { ok: true });
        }
        return;
      }

      // Handle inbound messages (responses from agent)
      if (msg.type === 'response' || msg.type === 'message' || msg.type === 'chunk') {
        // Forward to handler, don't output here
        if (this.messageHandler) {
          this.messageHandler(msg);
        }
      }
      
      // Handle event frames (like chat responses)
      if (msg.type === 'event') {
        // Handle connect challenge - need to respond
        if (msg.event === 'connect.challenge') {
          console.log('🔐 Challenge received, responding...');
          return;
        }
        
        // Skip verbose events in normal mode
        if (msg.event === 'health' || msg.event === 'tick') {
          return;
        }
        
        // Handle agent events - just pass to handler, don't output here
        if (msg.event === 'agent') {
          // Just forward to handler
        }
        
        if (this.eventHandler) {
          this.eventHandler(msg);
        }
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  }

  /**
   * Send a message to the agent
   */
  async send(message) {
    const id = this.nextId();
    
    // Generate session key and idempotency key if not already done
    if (!this.sessionKey) {
      this.sessionKey = this.generateSessionKey();
    }
    
    const request = {
      type: 'req',
      method: 'chat.send',
      id,
      params: {
        sessionKey: this.sessionKey,
        message,
        idempotencyKey: this.generateIdempotencyKey(),
      },
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));
      
      // Timeout after 60 seconds for chat responses
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout (60s)'));
        }
      }, 60000);
    });
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * Register a handler for events
   */
  onEvent(handler) {
    this.eventHandler = handler;
  }

  /**
   * Close the connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// CLI Interface
const args = process.argv.slice(2);

if (args[0] === 'send' && args[1]) {
  const message = args.slice(1).join(' ');
  
  const client = new AClientWebSocket();
  
  // Track our active runId to filter only our responses
  let activeRunId = null;
  
  // Set up event handler to capture agent responses
  client.onEvent((msg) => {
    if (msg.event === 'agent') {
      const payload = msg.payload;
      
      // Track our active runId from the first event
      if (!activeRunId && payload.runId) {
        activeRunId = payload.runId;
      }
      
      // Only show messages for our runId
      if (activeRunId && payload.runId !== activeRunId) {
        return; // Skip events from other runs
      }
      
      // Handle assistant stream (actual text response)
      if (payload.stream === 'assistant') {
        const text = payload.data?.text || payload.data?.delta;
        if (text) {
          console.log('📝 Agent:', text);
        }
      }
      
      // Clear runId when done
      if (payload.stream === 'lifecycle' && payload.data?.phase === 'end') {
        activeRunId = null;
      }
    }
  });
  
  client.connect()
    .then(() => {
      console.log('🔗 Session connected, sending message...');
      console.log(`📤 Sending: "${message}"`);
      return client.send(message);
    })
    .then(() => {
      console.log('✅ Message sent! (Waiting for agent response...)');
      // Wait a bit for the response
      setTimeout(() => {
        client.close();
        process.exit(0);
      }, 5000);
    })
    .catch((err) => {
      console.error('❌ Error:', err.message);
      client.close();
      process.exit(1);
    });

} else if (args[0] === 'interactive' || args[0] === 'chat') {
  const readline = await import('readline');
  
  const client = new AClientWebSocket();
  
  // Track our active runId to filter only our responses
  let activeRunId = null;
  
  // Set up event handler to capture agent responses
  client.onEvent((msg) => {
    if (msg.event === 'agent') {
      const payload = msg.payload;
      
      // Track our active runId from the first event
      if (!activeRunId && payload.runId) {
        activeRunId = payload.runId;
      }
      
      // Only show messages for our runId
      if (activeRunId && payload.runId !== activeRunId) {
        return; // Skip events from other runs
      }
      
      // Handle assistant stream (actual text response)
      if (payload.stream === 'assistant') {
        const text = payload.data?.text || payload.data?.delta;
        if (text) {
          console.log('\n📝 Agent:', text);
        }
      }
      
      // Clear runId when done
      if (payload.stream === 'lifecycle' && payload.data?.phase === 'end') {
        activeRunId = null;
      }
    }
  });
  
  await client.connect();
  
  console.log('\n🟢 Interactive mode. Type your message and press Enter.');
  console.log('Type "exit" to quit.\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  rl.on('line', async (line) => {
    const input = line.trim();
    
    if (input.toLowerCase() === 'exit') {
      client.close();
      process.exit(0);
    }
    
    if (input) {
      try {
        await client.send(input);
      } catch (e) {
        console.error('Error:', e.message);
      }
    }
  });

} else {
  console.log(`
🟢 AClient - WebSocket Example for OpenClaw Gateway

Usage:
  node src/ws-client.js send "Your message here"
  node src/ws-client.js interactive

Environment variables (see .env.example):
  OPENCLAW_URL      - Gateway URL (default: http://localhost:3000)
  OPENCLAW_API_KEY - API key for authentication
  SESSION_LABEL    - Session identifier

WebSocket provides real-time bidirectional communication.
Use "interactive" mode for a chat-like experience.
`);
}
