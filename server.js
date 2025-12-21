const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')
const fs = require('fs')
const path = require('path')

// Global error handlers to prevent server crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err)
  // Don't exit in production - try to keep the server running
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1)
  }
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit - log and continue
})

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// Mime types for static file serving
const mimeTypes = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      const { pathname } = parsedUrl

      // Serve static files from /uploads directory
      if (pathname && pathname.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), pathname)

        // Security: prevent directory traversal
        if (!filePath.startsWith(path.join(process.cwd(), 'uploads'))) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase()
          const contentType = mimeTypes[ext] || 'application/octet-stream'
          res.setHeader('Content-Type', contentType)
          res.setHeader('Content-Disposition', 'inline')
          const fileStream = fs.createReadStream(filePath)
          fileStream.pipe(res)
          return
        } else {
          res.statusCode = 404
          res.end('File not found')
          return
        }
      }

      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  // Initialize Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
  })

  console.log('✅ Socket.IO server initialized')

  // Handle client connections
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`)

    // Join user-specific room
    socket.on('join', (data) => {
      if (data.userId) {
        socket.join(`user:${data.userId}`)
        console.log(`👤 User ${data.userId} joined their room`)
      }
      if (data.accountId) {
        socket.join(`account:${data.accountId}`)
        console.log(`📧 Account ${data.accountId} joined their room`)
      }
    })

    // Leave rooms
    socket.on('leave', (data) => {
      if (data.userId) {
        socket.leave(`user:${data.userId}`)
      }
      if (data.accountId) {
        socket.leave(`account:${data.accountId}`)
      }
    })

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`)
    })
  })

  // Subscribe to Redis for email sync updates
  const Redis = require('ioredis')
  const redisSubscriber = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      // Exponential backoff with max 30 seconds
      const delay = Math.min(times * 1000, 30000)
      console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${times})`)
      return delay
    },
    maxRetriesPerRequest: 3,
  })

  // Handle Redis connection errors gracefully
  redisSubscriber.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message)
    // Don't crash - Redis will auto-reconnect
  })

  redisSubscriber.on('connect', () => {
    console.log('✅ Redis connected')
  })

  redisSubscriber.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...')
  })

  redisSubscriber.subscribe('email:sync', (err) => {
    if (err) {
      console.error('Failed to subscribe to email:sync channel:', err)
    } else {
      console.log('✅ Subscribed to email:sync Redis channel')
    }
  })

  redisSubscriber.on('message', (channel, message) => {
    if (channel === 'email:sync') {
      try {
        const data = JSON.parse(message)
        console.log('📬 Broadcasting email sync update:', data)

        // Broadcast to specific account room
        if (data.accountId) {
          io.to(`account:${data.accountId}`).emit('email:synced', data)
        }

        // Broadcast to all connected clients
        io.emit('email:new', data)
      } catch (error) {
        console.error('Error parsing Redis message:', error)
      }
    }
  })

  httpServer
    .once('error', (err) => {
      console.error(err)
      process.exit(1)
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
    })
})

