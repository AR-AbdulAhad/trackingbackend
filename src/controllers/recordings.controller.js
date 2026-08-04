import { prisma } from '../lib/prisma.js';

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

    // Aggressively remove all surrogate characters (emojis, etc) to prevent MariaDB utf8 truncation bugs
    let sanitizedStr = "[]";
    try {
      const eventsStr = JSON.stringify(events);
      // This removes all characters in the surrogate ranges, safely eliminating 4-byte characters and unpaired surrogates
      sanitizedStr = eventsStr.replace(/[\uD800-\uDFFF]/g, "");
    } catch (e) {
      console.warn('Failed to sanitize events');
    }

    let recId = recordingId;

    if (!recId) {
      // Create empty recording first to bypass Prisma's JSON serialization bugs on MariaDB
      const recording = await prisma.sessionRecording.create({
        data: {
          visitorId,
          events: [],
          duration: 0,
          pageUrl: pageUrl || '',
        }
      });
      recId = Number(recording.id);
    }

    // Now update using our proven parameterized raw query
    await prisma.$executeRaw`
      UPDATE SessionRecording 
      SET events = JSON_MERGE_PRESERVE(events, ${sanitizedStr}),
          duration = ${duration || 0},
          pageUrl = ${pageUrl || ''}
      WHERE id = ${BigInt(recId)}
    `;

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
    res.json({ events: recording.events, duration: recording.duration, pageUrl: recording.pageUrl, createdAt: recording.createdAt });
  } catch (error) {
    console.error('Recording events fetch error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
