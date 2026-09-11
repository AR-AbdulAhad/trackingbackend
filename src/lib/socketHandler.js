import { processIdentifyVisitor } from '../controllers/visitor.controller.js';
import { processTrackEvent } from '../controllers/events.controller.js';

/**
 * Configure and register all Socket.io real-time event handlers
 * @param {import('socket.io').Server} io
 */
export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    const origin = socket.handshake.headers.origin || 'unknown';
    console.log(`[Socket.io] Client connected: ${socket.id} (origin: ${origin})`);

    // Handle visitor identification over WebSocket
    socket.on('visitor:identify', async (data, callback) => {
      try {
        const visitor = await processIdentifyVisitor(data);
        if (typeof callback === 'function') {
          callback({ success: true, visitor });
        }
      } catch (err) {
        console.error(`[Socket.io ${socket.id}] Error in visitor:identify:`, err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // Handle event tracking over WebSocket
    socket.on('events:track', async (data, callback) => {
      try {
        const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        const userAgent = socket.handshake.headers['user-agent'];

        const result = await processTrackEvent(data, { clientIp, userAgent });
        if (typeof callback === 'function') {
          callback(result);
        }
      } catch (err) {
        console.error(`[Socket.io ${socket.id}] Error in events:track:`, err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // Batch event tracking support for queued events
    socket.on('events:batch', async (batch = [], callback) => {
      if (!Array.isArray(batch)) {
        if (typeof callback === 'function') callback({ success: false, error: 'batch must be an array' });
        return;
      }
      try {
        const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        const userAgent = socket.handshake.headers['user-agent'];

        const results = [];
        for (const item of batch) {
          if (item?.eventName) {
            const res = await processTrackEvent(item, { clientIp, userAgent });
            results.push(res);
          }
        }
        if (typeof callback === 'function') {
          callback({ success: true, count: results.length });
        }
      } catch (err) {
        console.error(`[Socket.io ${socket.id}] Error in events:batch:`, err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.io] Client disconnected: ${socket.id} (reason: ${reason})`);
    });
  });
};
