import crypto from 'crypto';

export function verifyLinqWebhook(
  rawBody: string,
  headers: {
    'webhook-id'?: string;
    'webhook-timestamp'?: string;
    'webhook-signature'?: string;
  },
): boolean {
  const hasSignatureHeaders =
    headers['webhook-id'] && headers['webhook-signature'];
  if (!hasSignatureHeaders && process.env.NODE_ENV === 'development') {
    return true;
  }

  const secret = process.env.LINQ_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('LINQ_WEBHOOK_SECRET not set');
    return true;
  }

  const msgId = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signature = headers['webhook-signature'];

  if (!msgId || !timestamp || !signature) return false;

  const sentAt = parseInt(timestamp, 10);
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const fiveMinutes = 300;
  if (isNaN(sentAt) || Math.abs(nowInSeconds - sentAt) > fiveMinutes) return false;

  const signedContent = `${msgId}.${timestamp}.${rawBody}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const expectedBuf = Buffer.from(expectedSignature);
  return signature.split(' ').some((sig) => {
    if (!sig.startsWith('v1,')) return false;
    const receivedBuf = Buffer.from(sig.slice(3));
    return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
  });
}

export function extractTextFromParts(
  parts: { type: string; value: string }[],
): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.value)
    .join(' ')
    .trim();
}

const LINQ_API_BASE = 'https://api.linqapp.com/api/partner/v3';

function getApiKey(): string | undefined {
  return process.env.LINQ_API_KEY;
}

export async function startTypingIndicator(chatId: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const res = await fetch(`${LINQ_API_BASE}/chats/${chatId}/typing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`[linq] typing indicator failed: ${res.status}`);
    }
  } catch (err) {
    console.warn('[linq] typing indicator error:', err);
  }
}

export async function sendLinqMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('LINQ_API_KEY not set — skipping send');
    return;
  }

  if (!text || !text.trim()) {
    console.warn('[linq] skipping send — empty message');
    return;
  }

  // v3 API: POST /chats/{chatId}/messages with message.parts wrapper
  const res = await fetch(`${LINQ_API_BASE}/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      message: {
        parts: [{ type: 'text', value: text }],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linq send failed: ${res.status} ${body}`);
  }
}
