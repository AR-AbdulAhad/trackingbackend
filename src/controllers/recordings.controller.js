import { prisma } from '../lib/prisma.js';

export const createRecording = async (req, res) => {
  try {
    const { visitorId, events, duration, pageUrl } = req.body;
    if (!visitorId || !events) {
      return res.status(400).json({ error: 'visitorId and events are required' });
    }

    const recording = await prisma.sessionRecording.create({
      data: {
        visitorId,
        events,
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
    res.json({ events: recording.events, duration: recording.duration, pageUrl: recording.pageUrl });
  } catch (error) {
    console.error('Recording events fetch error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
