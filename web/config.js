// Frontend Configuration

const CONFIG = {
  // WebSocket Proxy URL - dynamically use current host
  wsUrl: (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.hostname + ':8084/',
  
  // Proxy token (for token-based auth)
  proxyToken: 'change-me-in-production',
  
  // API Server URL (for file uploads) - use empty string for same-origin
  apiUrl: '',
};
