/**
 * AClient - HTTP Client for OpenClaw Gateway
 * 
 * Simple example of sending messages to OpenClaw via HTTP
 * Run: node src/http-client.js
 */

import 'dotenv/config';

const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://localhost:3000';
const API_KEY = process.env.OPENCLAW_API_KEY || '';
const SESSION_LABEL = process.env.SESSION_LABEL || 'http-client-session';

async function sendMessage(message) {
  const response = await fetch(`${OPENCLAW_URL}/gateway/v1/chat.send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      label: SESSION_LABEL,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return response.json();
}

async function getSessionHistory(sessionKey) {
  const response = await fetch(
    `${OPENCLAW_URL}/gateway/v1/sessions/history?key=${encodeURIComponent(sessionKey)}`,
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function listSessions() {
  const response = await fetch(`${OPENCLAW_URL}/gateway/v1/sessions/list?limit=10`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// CLI Interface
const args = process.argv.slice(2);

if (args[0] === 'send' && args[1]) {
  const message = args.slice(1).join(' ');
  console.log(`📤 Sending: "${message}"`);
  sendMessage(message)
    .then((result) => {
      console.log('✅ Response:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
} else if (args[0] === 'list') {
  console.log('📋 Listing sessions...');
  listSessions()
    .then((result) => {
      console.log('✅ Sessions:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
} else {
  console.log(`
🟢 AClient - HTTP Example for OpenClaw Gateway

Usage:
  node src/http-client.js send "Your message here"
  node src/http-client.js list

Environment variables (see .env.example):
  OPENCLAW_URL      - Gateway URL (default: http://localhost:3000)
  OPENCLAW_API_KEY - API key for authentication
  SESSION_LABEL    - Session identifier
`);
}
