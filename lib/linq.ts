import crypto from 'crypto';

export function verifyLinqWebhook(
  rawBody: string,
  headers: { 'webhook-id'?: string; 'webhook-timestamp'?: string; 'webhook-signature'?: string }
): boolean {
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

export async function sendLinqMessage(toHandle: string, text: string): Promise<void> {
  const apiKey = process.env.LINQ_API_KEY;
  const fromNumber = process.env.LINQ_PHONE_NUMBER;

  if (!apiKey || !fromNumber) {
    console.warn('Linq credentials not set — skipping send');
    return;
  }

  const res = await fetch('https://api.linqapp.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromNumber,
      to: toHandle,
      parts: [{ type: 'text', value: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linq send failed: ${res.status} ${body}`);
  }
}
