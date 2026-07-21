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
  if (eventName === 'purchase_completed') metaEventName = 'Purchase';

  const externalId = crypto.createHash('sha256').update(visitorId.trim().toLowerCase()).digest('hex');
  
  const userData = {
    client_ip_address: reqIp,
    client_user_agent: reqUserAgent,
    external_id: [externalId],
  };

  // Only hash email if consent is given
  if (eventParams.consentGiven && eventParams.email) {
    userData.em = [crypto.createHash('sha256').update(eventParams.email.trim().toLowerCase()).digest('hex')];
  }

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
