export const SAMPLE_A = `import { createServer } from 'node:http'
import { readConfig } from './config.js'

const config = readConfig()
const PORT = Number(process.env.PORT ?? 3000)

function handle(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end('Not found')
}

const server = createServer(handle)
server.listen(PORT, () => {
  console.log('Listening on port ' + PORT)
})

// Graceful shutdown
process.on('SIGTERM', () => server.close())
`

export const SAMPLE_B = `import { createServer } from 'node:http'
import { readConfig } from './config.js'
import { logger } from './logger.js'

const config = readConfig()
const PORT = Number(process.env.PORT ?? 8080)

function handle(req, res) {
  if (req.url === '/health' || req.url === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
    return
  }
  res.writeHead(404)
  res.end('Not found')
}

const server = createServer(handle)
server.listen(PORT, () => {
  logger.info(\`Listening on port \${PORT}\`)
})

// Graceful shutdown
process.on('SIGTERM', () => server.close())
process.on('SIGINT', () => server.close())
`
