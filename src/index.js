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

// CORS config
const allowedOrigins = [
  'https://studentlife.dk',
  'https://studenterhue.studentlife.dk',
  'https://cloth.studentlife.dk',
  'https://trackingdashboard.studentlife.dk',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
];

const isOriginAllowed = (origin) => {
  if (!origin) return true; // allow non-browser or same-origin requests
  if (allowedOrigins.indexOf(origin) !== -1) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/([a-zA-Z0-9-]+\.)*studentlife\.dk(:\d+)?$/.test(origin)) return true;
  return false;
};

// Socket.io server
export const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Setup real-time tracking & dashboard socket handlers
setupSocketHandlers(io);

// Middleware
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // increased for rrweb event batches

app.use(cors({
  origin: function (origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

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
