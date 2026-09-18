import crypto from 'crypto';

export const sendMetaEvent = async (
  eventName,
  visitorId,
  eventParams,
  reqIp,
  reqUserAgent
) => {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !token) {
    console.warn('Meta CAPI not configured. Skipping event:', eventName);
    return;
  }

  // Map to standard events
  let metaEventName = eventName;
  if (eventName === 'add_to_cart') metaEventName = 'AddToCart';
  if (eventName === 'checkout_started') metaEventName = 'InitiateCheckout';
  if (eventName === 'purchase_completed' || eventName === 'purchase') metaEventName = 'Purchase';

  const externalId = crypto.createHash('sha256').update(visitorId.trim().toLowerCase()).digest('hex');
  
  const hashField = (val) => {
    if (!val || typeof val !== 'string') return null;
    return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex');
  };

  const userData = {
    client_ip_address: reqIp,
    client_user_agent: reqUserAgent,
    external_id: [externalId],
  };

  const rawEm = eventParams.email || eventParams.customerEmail;
  if (rawEm) {
    userData.em = [hashField(rawEm)];
  }

  const rawPh = eventParams.phone || eventParams.customerPhone || eventParams.fullPhone;
  if (rawPh) {
    const cleanPh = String(rawPh).replace(/[^0-9]/g, '');
    if (cleanPh) userData.ph = [crypto.createHash('sha256').update(cleanPh).digest('hex')];
  }

  if (eventParams.firstName) userData.fn = [hashField(eventParams.firstName)];
  if (eventParams.lastName) userData.ln = [hashField(eventParams.lastName)];
  if (eventParams.city) userData.ct = [hashField(eventParams.city)];
  if (eventParams.postalCode) userData.zp = [hashField(String(eventParams.postalCode))];
  if (eventParams.country) userData.country = [hashField(eventParams.country.toLowerCase() === 'denmark' ? 'dk' : eventParams.country)];

  const customData = {};
  if (eventParams.value) customData.value = parseFloat(eventParams.value);
  if (eventParams.currency) customData.currency = eventParams.currency;

  const payload = {
    data: [
      {
        event_name: metaEventName,
        event_time: Math.floor(Date.now() / 1000),
        user_data: userData,
        custom_data: customData,
        action_source: 'website',
      }
    ]
  };

  try {
    const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Meta CAPI Error:', await response.text());
    }
  } catch (error) {
    console.error('Failed to send Meta CAPI event:', error);
  }
};
