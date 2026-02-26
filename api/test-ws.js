import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8084/?token=change-me-in-production');

ws.on('open', () => {
  console.log('✅ Connected to proxy');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📥', msg.type, '-', msg.method || msg.event || (msg.ok ? 'OK' : 'error'));
  
  // After connected, send chat message
  if (msg.type === 'res' && msg.ok && msg.method === 'connect') {
    console.log('📤 Sending chat message...');
    ws.send(JSON.stringify({
      type: 'req',
      method: 'chat.send',
      id: 'test-1',
      params: {
        message: 'Hello from test.js!'
      }
    }));
  }
});

ws.on('error', (e) => console.log('❌ Error:', e.message));
ws.on('close', () => console.log('🔌 Closed'));

// Exit after 10 seconds
setTimeout(() => {
  console.log('Done');
  ws.close();
  process.exit(0);
}, 10000);
