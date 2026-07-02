import crypto from 'crypto';

export function verifyLinqWebhook(
  rawBody: string,
  headers: { 'webhook-id'?: string; 'webhook-timestamp'?: string; 'webhook-signature'?: string }
): boolean {
  // skip verification in local dev when no signature headers are present
  const hasSignatureHeaders = headers['webhook-id'] && headers['webhook-signature'];
  if (!hasSignatureHeaders && process.env.NODE_ENV === 'development') {
    return true;
  }

  const secret = process.env.LINQ_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('LINQ_WEBHOOK_SECRET not set — skipping verification');
    return true;
  }

  const msgId = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signature = headers['webhook-signature'];

  if (!msgId || !timestamp || !signature) return false;

  const signedContent = `${msgId}.${timestamp}.${rawBody}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computed = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const expectedSignatures = signature.split(' ').map((s) => s.replace(/^v1,/, ''));
  return expectedSignatures.some((sig) => sig === computed);
}

export function extractTextFromParts(parts: { type: string; value: string }[]): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.value)
    .join(' ')
    .trim();
}

// Send a reply into an existing chat thread.
// chatId comes from payload.data.chat.id on the inbound webhook.
export async function sendLinqMessage(chatId: string, text: string): Promise<void> {
  const apiKey = process.env.LINQ_API_KEY;

  if (!apiKey) {
    console.warn('LINQ_API_KEY not set — skipping send');
    return;
  }

  if (!text || !text.trim()) {
    console.warn('[linq] skipping send — empty message');
    return;
  }

  // v3 API: POST /chats/{chatId}/messages with message.parts wrapper
  const res = await fetch(`https://api.linqapp.com/api/partner/v3/chats/${chatId}/messages`, {
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
