import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { verifyLinqWebhook, extractTextFromParts } from "@/lib/linq";

interface LinqWebhookPayload {
  event_type: string;
  event_id: string;
  created_at: string;
  data: {
    id: string;
    direction: "inbound" | "outbound";
    sender_handle: {
      handle: string;
      is_me: boolean;
    };
    chat: {
      id: string;
      is_group: boolean;
      owner_handle: { handle: string };
    };
    parts: { type: string; value: string }[];
    sent_at: string;
    service: string;
  };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const valid = verifyLinqWebhook(rawBody, {
    "webhook-id": req.headers.get("webhook-id") ?? undefined,
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? undefined,
    "webhook-signature": req.headers.get("webhook-signature") ?? undefined,
  });

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: LinqWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    payload.event_type !== "message.received" ||
    payload.data.direction !== "inbound"
  ) {
    return NextResponse.json({ received: true });
  }

  const eventId = payload.event_id;
  const phoneNumber = payload.data.sender_handle.handle;
  const text = extractTextFromParts(payload.data.parts);

  if (!text) return NextResponse.json({ received: true });

  const existing = await db.query.messages.findFirst({
    where: eq(messages.linqEventId, eventId),
  });
  if (existing)
    return NextResponse.json({ received: true, deduplicated: true });

  let conversation = await db.query.conversations.findFirst({
    where: eq(conversations.phoneNumber, phoneNumber),
  });
  if (!conversation) {
    const [created] = await db
      .insert(conversations)
      .values({ phoneNumber })
      .returning();
    conversation = created;
  }

  await db.insert(messages).values({
    conversationId: conversation.id,
    linqEventId: eventId,
    direction: "inbound",
    body: text,
  });

  console.log(`[webhook] inbound from ${phoneNumber}: "${text}"`);

  return NextResponse.json({ received: true });
}
