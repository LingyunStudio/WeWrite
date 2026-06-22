/*
 * WeWrite 静态文件服务器
 * 零依赖，仅使用 Node 内置模块
 * 启动：node server.js [端口号]
 * 默认端口 3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.map':  'application/json; charset=utf-8'
};

function safeJoin(base, target) {
  const resolved = path.resolve(base, '.' + target);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const filePath = safeJoin(ROOT, urlPath);
    if (!filePath) {
      res.writeHead(403); res.end('403 Forbidden'); return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = `http://127.0.0.1:${PORT}/`;
  console.log('');
  console.log('==============================================');
  console.log('  WeWrite 已启动');
  console.log('  在浏览器中打开: ' + addr);
  console.log('  按 Ctrl+C 停止服务');
  console.log('==============================================');
  console.log('');
  // 尝试自动打开浏览器（Windows）
  try {
    const { exec } = require('child_process');
    exec('start "" "' + addr + '"');
  } catch (e) {}
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请换一个端口：node server.js 3001');
  } else {
    console.error('服务器错误:', err.message);
  }
  process.exit(1);
});
