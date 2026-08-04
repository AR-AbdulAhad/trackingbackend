import { prisma } from '../lib/prisma.js';
import fs from 'fs/promises';
import path from 'path';

// Define a local directory for storing heavy JSON payloads
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings_data');
// Ensure directory exists
fs.mkdir(RECORDINGS_DIR, { recursive: true }).catch(() => {});

export const createRecording = async (req, res) => {
  try {
    const { recordingId, visitorId, events, duration, pageUrl } = req.body;
    if (!visitorId || !events) {
      return res.status(400).json({ error: 'visitorId and events are required' });
    }

    // Ensure visitor exists to prevent foreign key constraint violations
    try {
      await prisma.visitor.upsert({
        where: { visitorId },
        update: {},
        create: {
          visitorId,
          visitCount: 1,
          firstVisitAt: new Date(),
          lastVisitAt: new Date(),
          isReturning: false,
        }
      });
    } catch (upsertError) {
      if (upsertError.code !== 'P2002') {
        throw upsertError;
      }
    }

    let recId = recordingId;

    if (!recId) {
      // Create empty recording in DB to completely bypass MariaDB JSON limits and packet limits
      const recording = await prisma.sessionRecording.create({
        data: {
          visitorId,
          events: [], // Empty array in DB
          duration: duration || 0,
          pageUrl: pageUrl || '',
        }
      });
      recId = Number(recording.id);
      
      // Save initial events to File System
      await fs.writeFile(path.join(RECORDINGS_DIR, `${recId}.json`), JSON.stringify(events));
    } else {
      // Update existing recording
      const filePath = path.join(RECORDINGS_DIR, `${recId}.json`);
      try {
        const existingData = await fs.readFile(filePath, 'utf-8');
        const existingEvents = JSON.parse(existingData);
        existingEvents.push(...events);
        await fs.writeFile(filePath, JSON.stringify(existingEvents));
      } catch (e) {
        // If file doesn't exist, just write it
        await fs.writeFile(filePath, JSON.stringify(events));
      }

      await prisma.sessionRecording.update({
        where: { id: BigInt(recId) },
        data: { 
          duration: duration || 0,
          pageUrl: pageUrl || ''
        }
      });
    }

    res.json({ id: recId });
  } catch (error) {
    console.error('Recording create error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getRecordingsByVisitor = async (req, res) => {
  try {
    const { visitorId } = req.params;
    const recordings = await prisma.sessionRecording.findMany({
      where: { visitorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, duration: true, pageUrl: true, createdAt: true }
    });
    res.json(recordings.map(r => ({ ...r, id: Number(r.id) })));
  } catch (error) {
    console.error('Recordings fetch error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getRecordingEvents = async (req, res) => {
  try {
    const { id } = req.params;
    const recording = await prisma.sessionRecording.findUnique({
      where: { id: BigInt(id) }
    });
    if (!recording) return res.status(404).json({ error: 'Recording not found' });

    let finalEvents = [];
    try {
      // Try to load from File System first (new approach)
      const filePath = path.join(RECORDINGS_DIR, `${id}.json`);
      const fileData = await fs.readFile(filePath, 'utf-8');
      finalEvents = JSON.parse(fileData);
    } catch(e) {
      // Fallback to DB if file doesn't exist (for old recordings before this fix)
      finalEvents = recording.events;
    }

    res.json({ 
      events: finalEvents, 
      duration: recording.duration, 
      pageUrl: recording.pageUrl, 
      createdAt: recording.createdAt 
    });
  } catch (error) {
    console.error('Recording events fetch error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
