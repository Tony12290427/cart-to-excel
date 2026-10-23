// Local preview serves only the generator's public assets, not platform data or credentials.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const publicFiles = new Set(['index.html', 'drive-config.js', 'drive-upload.js', 'order-import.js', 'privacy.html', 'template.xlsx']);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.jpg':'image/jpeg', '.png':'image/png', '.mp4':'video/mp4' };
const server = http.createServer(async (request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
  if (!['GET','HEAD'].includes(request.method) || !publicFiles.has(name) && !/^media\/[A-Za-z0-9_.-]+\.(?:jpg|png|mp4)$/.test(name)) {
    response.writeHead(404); return response.end('Not found');
  }
  try {
    const content = await fs.readFile(path.join(root, name));
    response.writeHead(200, { 'Content-Type':types[path.extname(name)] || 'application/octet-stream', 'Content-Length':content.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => console.log(`Order form preview: http://127.0.0.1:${server.address().port}`));
