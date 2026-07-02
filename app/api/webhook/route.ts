import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
  trips,
  catches,
  alerts,
} from "@/lib/db/schema";
import {
  verifyLinqWebhook,
  extractTextFromParts,
  sendLinqMessage,
} from "@/lib/linq";
import { processMessage } from "@/lib/agent";

interface LinqMessagePayload {
  event_type: "message.received";
  event_id: string;
  created_at: string;
  data: {
    id: string;
    direction: "inbound" | "outbound";
    sender_handle: { handle: string; is_me: boolean };
    chat: { id: string; is_group: boolean; owner_handle: { handle: string } };
    parts: { type: string; value: string }[];
    sent_at: string;
    service: string;
  };
}

interface LinqReactionPayload {
  event_type: "reaction.added" | "reaction.removed";
  event_id: string;
  created_at: string;
  data: {
    chat_id: string;
    message_id: string;
    part_index: number;
    reaction_type:
      | "love"
      | "like"
      | "dislike"
      | "laugh"
      | "emphasize"
      | "question"
      | "custom"
      | "sticker";
    custom_emoji: string | null;
    is_from_me: boolean;
    from: string;
  };
}

type LinqWebhookPayload = LinqMessagePayload | LinqReactionPayload;

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const valid = verifyLinqWebhook(rawBody, {
    "webhook-id": req.headers.get("webhook-id") ?? undefined,
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? undefined,
    "webhook-signature": req.headers.get("webhook-signature") ?? undefined,
  });
  if (!valid)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: LinqWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    payload.event_type === "reaction.added" &&
    payload.data.reaction_type === "like" &&
    !payload.data.is_from_me
  ) {
    const phoneNumber = payload.data.from;
    const chatId = payload.data.chat_id;

    const allowedNumbers = (process.env.ALLOWED_PHONE_NUMBERS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (allowedNumbers.length > 0 && !allowedNumbers.includes(phoneNumber)) {
      return NextResponse.json({ received: true });
    }

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.phoneNumber, phoneNumber),
    });

    if (conversation) {
      const recentTrip = await db.query.trips.findFirst({
        where: eq(trips.conversationId, conversation.id),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

      const appUrl = process.env.APP_URL ?? "https://linq-viz.vercel.app";

      if (recentTrip) {
        await sendLinqMessage(
          chatId,
          `🤿 Full breakdown → ${appUrl}/report/${recentTrip.id}`,
        );
      }
    }

    return NextResponse.json({ received: true });
  }

  if (
    payload.event_type !== "message.received" ||
    payload.data.direction !== "inbound"
  ) {
    return NextResponse.json({ received: true });
  }

  const eventId = payload.event_id;
  const phoneNumber = payload.data.sender_handle.handle;
  const chatId = payload.data.chat.id;
  const text = extractTextFromParts(payload.data.parts);

  const allowedNumbers = (process.env.ALLOWED_PHONE_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (allowedNumbers.length > 0 && !allowedNumbers.includes(phoneNumber)) {
    return NextResponse.json({ received: true });
  }

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

  const appUrl = process.env.APP_URL ?? "https://linq-viz.vercel.app";
  const normalized = text.toLowerCase().trim();

  if (normalized === "deets") {
    const recentTrip = await db.query.trips.findFirst({
      where: eq(trips.conversationId, conversation.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (recentTrip) {
      await sendLinqMessage(
        chatId,
        `🤿 Full breakdown → ${appUrl}/report/${recentTrip.id}`,
      );
    } else {
      await sendLinqMessage(
        chatId,
        `No recent trip found. Send me a dive spot and date first.`,
      );
    }

    return NextResponse.json({ received: true });
  }

  if (normalized === "remind me") {
    const recentTrip = await db.query.trips.findFirst({
      where: eq(trips.conversationId, conversation.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (recentTrip && !recentTrip.alarmSet) {
      const fireAt = new Date(recentTrip.plannedDate);
      fireAt.setHours(5, 0, 0, 0);

      await db.insert(alerts).values({
        conversationId: conversation.id,
        type: "morning_alarm",
        tripId: recentTrip.id,
        spotName: recentTrip.spotName,
        fireAt,
      });

      await db
        .update(trips)
        .set({ alarmSet: true })
        .where(eq(trips.id, recentTrip.id));
      await sendLinqMessage(
        chatId,
        `Got it. I'll text you at 5am on the day of your dive with updated conditions for ${recentTrip.spotName}.`,
      );
    } else if (recentTrip?.alarmSet) {
      await sendLinqMessage(
        chatId,
        `You're already set for a 5am update for ${recentTrip.spotName}.`,
      );
    } else {
      await sendLinqMessage(
        chatId,
        `No recent trip found. Send me a dive spot and date first.`,
      );
    }

    return NextResponse.json({ received: true });
  }

  let result;
  try {
    result = await processMessage(text);
  } catch (err) {
    console.error("[agent] error:", err);
    try {
      await sendLinqMessage(
        chatId,
        "Something went wrong on my end. Try again.",
      );
    } catch (sendErr) {
      console.error("[send] error:", sendErr);
    }
    return NextResponse.json({ received: true });
  }

  if (result.intent === "trip_plan" && result.tripData) {
    const d = result.tripData;
    await db.insert(trips).values({
      conversationId: conversation.id,
      spotName: d.spotName,
      latitude: d.latitude,
      longitude: d.longitude,
      plannedDate: d.plannedDate.toISOString().split("T")[0],
      targetSpecies: d.targetSpecies ?? undefined,
      vizScore: d.vizScore,
      vizSummary: d.vizSummary,
      conditionsSnapshot: d.conditionsSnapshot,
    });
  }

  if (result.intent === "catch_log" && result.catchData) {
    const c = result.catchData;
    await db.insert(catches).values({
      conversationId: conversation.id,
      species: c.species,
      lengthInches: c.lengthInches ?? undefined,
      spotName: c.spotName ?? undefined,
      isLegal: c.isLegal ?? undefined,
    });
  }

  try {
    await sendLinqMessage(chatId, result.replyText);
    await db.insert(messages).values({
      conversationId: conversation.id,
      direction: "outbound",
      body: result.replyText,
    });
  } catch (err) {
    console.error("[send] error:", err);
  }

  return NextResponse.json({ received: true });
}
