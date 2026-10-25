import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleForum } from '../lib/forum.js';
import { handleAuth } from '../lib/auth-handler.js';
const files = new Map([['/', ['index.html','text/html; charset=utf-8']], ['/index.html', ['index.html','text/html; charset=utf-8']], ['/forum.js', ['forum.js','text/javascript; charset=utf-8']], ['/forum.css', ['forum.css','text/css; charset=utf-8']]]);
const port = Number(process.env.PORT || 3000);
files.set('/score-model.js', ['score-model.js', 'text/javascript; charset=utf-8']);
for (const name of ['score-import.js', 'rhythm-model.js']) files.set('/'+name, [name, 'text/javascript; charset=utf-8']);
files.set('/accounts.js', ['accounts.js', 'text/javascript; charset=utf-8']);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/forum' || url.pathname === '/api/auth') {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: req, duplex: 'half' } : {}) });
      const response = await (url.pathname === '/api/auth' ? handleAuth : handleForum)(request);
      const headers = Object.fromEntries(response.headers);
      if (response.headers.getSetCookie().length) headers['set-cookie'] = response.headers.getSetCookie();
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } else if (/^\/omr\/[a-zA-Z0-9_./-]+$/.test(url.pathname) && !url.pathname.split('/').includes('..') && ['GET','HEAD'].includes(req.method)) {
      const ext = url.pathname.split('.').pop();
      const type = {js:'text/javascript',mjs:'text/javascript',wasm:'application/wasm',onnx:'application/octet-stream',txt:'text/plain'}[ext];
      if (!type) { res.writeHead(404); res.end(); return; }
      try { const data=await readFile('public'+url.pathname);res.writeHead(200,{'Content-Type':type});res.end(req.method==='HEAD'?'':data); } catch {res.writeHead(404);res.end('Run npm run build first');}
    } else if (files.has(url.pathname) && ['GET','HEAD'].includes(req.method)) {
      const [file, type] = files.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? '' : await readFile(file));
    } else { res.writeHead(404); res.end('Not found'); }
  } catch { res.writeHead(500); res.end('Server error'); }
}).listen(port, '127.0.0.1', () => console.log(`Composer available at http://localhost:${port}`));
