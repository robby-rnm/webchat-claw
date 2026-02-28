import express from 'express';
import { createServer } from 'http';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_PORT = process.env.API_PORT || 8084;

const app = express();

// Simple proxy middleware for API requests
app.use('/api', (req, res) => {
  // Keep the full path including /api
  const options = {
    hostname: 'localhost',
    port: API_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });
});

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve uploaded files from uploads directory (symlinked to API uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log('AClaw Web Server running on port ' + PORT);
  console.log('API Proxy: http://localhost:' + PORT + '/api -> http://localhost:' + API_PORT);
});
