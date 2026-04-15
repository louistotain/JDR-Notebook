const http = require('http');
const fs = require('fs');
const path = require('path');

function getCliPort() {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));

  if (!portArg) {
    return null;
  }

  const value = Number(portArg.split('=')[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const PORT = getCliPort() || Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? path.join(__dirname, 'public', 'index.html') : null;

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Not Found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 - Erreur serveur');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} déjà utilisé. Lancez avec PORT=3001 npm start ou npm start -- --port=3001`);
    process.exit(1);
  }

  console.error('Erreur serveur:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Serveur démarré sur http://${HOST}:${PORT}`);
});
