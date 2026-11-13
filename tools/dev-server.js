// Servidor local: arquivos estáticos + a função /api/char (como na Vercel).
//   node tools/dev-server.js [porta = 5598]
const http = require('http')
const fs = require('fs')
const path = require('path')
const handler = require('../api/char.js')

const ROOT = path.join(__dirname, '..')
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain',
}
const port = +process.argv[2] || 5598

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    // só local: tools/og.html grava os PNGs gerados (ícones e imagem de compartilhamento)
    // só aceita de páginas do próprio servidor (outro site aberto no navegador não grava arquivos)
    const sameOrigin = !req.headers.origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)
    if (req.method === 'POST' && url.pathname === '/__save' && sameOrigin && /^[a-z0-9-]+\.png$/.test(url.searchParams.get('name') || '')) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        fs.writeFileSync(path.join(ROOT, url.searchParams.get('name')), Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'))
        res.writeHead(204).end()
      })
      return
    }
    if (url.pathname === '/api/char') {
      req.query = Object.fromEntries(url.searchParams)
      res.status = (code) => ((res.statusCode = code), res)
      res.json = (body) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      }
      return handler(req, res)
    }
    let rel
    try {
      rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
    } catch (e) {
      return res.writeHead(400).end()
    }
    const file = path.join(ROOT, rel)
    // dentro da pasta do projeto (startsWith deixaria passar uma pasta irmã com o mesmo prefixo)
    const inside = path.relative(ROOT, file)
    if (inside.startsWith('..') || path.isAbsolute(inside)) return res.writeHead(403).end()
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end()
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port))
