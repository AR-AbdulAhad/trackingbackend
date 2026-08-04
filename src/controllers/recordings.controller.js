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

    // Remove unpaired surrogates which cause MySQL JSON validation to fail
    let sanitizedStr = "[]";
    let safeEvents = events;
    try {
      const eventsStr = JSON.stringify(events);
      sanitizedStr = eventsStr.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|([^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1\uFFFD");
      safeEvents = JSON.parse(sanitizedStr);
    } catch (e) {
      console.warn('Failed to sanitize events');
    }

    if (recordingId) {
      await prisma.$executeRaw`
        UPDATE SessionRecording 
        SET events = JSON_MERGE_PRESERVE(events, CAST(${sanitizedStr} AS JSON)),
            duration = ${duration || 0},
            pageUrl = ${pageUrl || ''}
        WHERE id = ${BigInt(recordingId)}
      `;
      return res.json({ id: recordingId });
    }

    const recording = await prisma.sessionRecording.create({
      data: {
        visitorId,
        events: safeEvents,
        duration: duration || 0,
        pageUrl: pageUrl || '',
      }
    });

    res.json({ id: Number(recording.id) });
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
