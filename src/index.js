import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import visitorRoutes from './routes/visitor.js';
import eventRoutes from './routes/events.js';
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import recordingRoutes from './routes/recordings.js';
import userRoutes from './routes/users.js';
import gaRoutes from './routes/ga.js';
import './cron.js';

import { setupSocketHandlers } from './lib/socketHandler.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3000;

// Socket.io server
export const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Setup real-time tracking & dashboard socket handlers
setupSocketHandlers(io);

// CORS Middleware (Placed at top before body parsers)
const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
});

app.use(corsMiddleware);
app.options(/.*/, corsMiddleware); // Explicit preflight handler (Express 5 compatible)

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // increased for rrweb event batches

// Routes
app.use('/api/visitor', visitorRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ga', gaRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
    },
  });
});

httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// touch
