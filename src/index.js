/**
 * AClient - Client Library for OpenClaw Gateway
 * 
 * Connect your applications to OpenClaw and chat with AI agents
 * 
 * @example
 * import { AClient } from './src/index.js';
 * 
 * const client = new AClient({
 *   url: 'http://localhost:3000',
 *   apiKey: 'your-api-key'
 * });
 * 
 * await client.connect();
 * const response = await client.send('Hello, agent!');
 * console.log(response);
 */

export { AClientWebSocket } from './ws-client.js';
export { default as HttpClient } from './http-client.js';
