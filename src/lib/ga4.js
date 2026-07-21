export const sendGA4Event = async (
  eventName,
  visitorId,
  eventParams
) => {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) {
    console.warn('GA4 MP not configured. Skipping event:', eventName);
    return;
  }

  const payload = {
    client_id: visitorId,
    events: [
      {
        name: eventName,
        params: eventParams,
      }
    ]
  };

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('GA4 MP Error:', await response.text());
    }
  } catch (error) {
    console.error('Failed to send GA4 event:', error);
  }
};
