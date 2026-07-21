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
import './cron.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3000;

// CORS config
const allowedOrigins = [
  'https://studentlife.dk',
  'https://config.studentlife.dk',
  'https://studywear.studentlife.dk',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

// Socket.io server
export const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected:', socket.id);
  });
});

// Middleware
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // increased for rrweb event batches

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Routes
app.use('/api/visitor', visitorRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/users', userRoutes);

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
