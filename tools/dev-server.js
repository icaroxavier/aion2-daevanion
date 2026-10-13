// Servidor local: arquivos estáticos + a função /api/char (como na Vercel).
//   node tools/dev-server.js [porta = 5598]
const http = require('http')
const fs = require('fs')
const path = require('path')
const handler = require('../api/char.js')

const ROOT = path.join(__dirname, '..')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp' }
const port = +process.argv[2] || 5598

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/char') {
      req.query = Object.fromEntries(url.searchParams)
      res.status = (code) => ((res.statusCode = code), res)
      res.json = (body) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      }
      return handler(req, res)
    }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname))
    if (!file.startsWith(ROOT)) return res.writeHead(403).end()
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end()
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port))
