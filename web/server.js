import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

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
  const host = process.env.HOST || 'localhost';
  console.log(`
🟢 AClaw Web Server
   Local:   http://localhost:${PORT}
   Network: http://${host}:${PORT}
   
   WebSocket Proxy: ws://localhost:8084/
  `);
});
