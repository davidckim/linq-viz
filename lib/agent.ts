import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { fetchConditions } from "./data/index";
import { computeVizScore } from "./viz-score";

// California fish regulations - keeping this hardcoded for now
// would pull from CDFW API in a real version but their data isn't structured well
const REGS: Record<
  string,
  { minInches: number; bagLimit: number; season: string }
> = {
  "calico bass": { minInches: 12, bagLimit: 10, season: "year-round" },
  "white seabass": { minInches: 28, bagLimit: 3, season: "year-round" },
  yellowtail: { minInches: 24, bagLimit: 10, season: "year-round" },
  halibut: { minInches: 22, bagLimit: 5, season: "year-round" },
  sheephead: { minInches: 12, bagLimit: 5, season: "year-round" },
  lingcod: { minInches: 22, bagLimit: 2, season: "year-round" },
  rockfish: { minInches: 10, bagLimit: 10, season: "year-round" },
};

// step 1: parse what the user is asking for
const IntentSchema = z.object({
  type: z.enum(["trip_plan", "catch_log", "question", "other"]),
  location: z.string().nullable(),
  date: z.string().nullable(),
  targetSpecies: z.string().nullable(),
  species: z.string().nullable(),
  lengthInches: z.number().nullable(),
  spotName: z.string().nullable(),
  directReply: z.string().nullable(),
});

type Intent = z.infer<typeof IntentSchema>;

// step 2: geocode the location string to lat/lng
// using GPT for this instead of a geocoding API to avoid another dependency
const GeoSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  displayName: z.string(), // cleaned up name like "Malibu, CA"
});

async function geocodeLocation(location: string) {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: GeoSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    prompt: `Return the latitude, longitude, and a clean display name for this SoCal dive location: "${location}". If it's a general area like "Malibu" use the center of the coastline there.`,
  });
  return object;
}

// parse a natural language date like "this Saturday" into a JS Date
function parseTargetDate(dateStr: string): Date {
  const lower = dateStr.toLowerCase();
  const today = new Date();

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  for (const [i, name] of dayNames.entries()) {
    if (lower.includes(name)) {
      const todayDay = today.getDay();
      let daysUntil = i - todayDay;
      if (daysUntil <= 0) daysUntil += 7;
      const target = new Date(today);
      target.setDate(today.getDate() + daysUntil);
      return target;
    }
  }

  // fall back to tomorrow if we can't parse it
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return tomorrow;
}

export function checkLegality(
  species: string,
  lengthInches: number,
): {
  isLegal: boolean;
  message: string;
} {
  const key = Object.keys(REGS).find((k) => species.toLowerCase().includes(k));
  if (!key) {
    return {
      isLegal: true,
      message: `No size limit data for ${species} — verify with CDFW.`,
    };
  }
  const reg = REGS[key];
  const legal = lengthInches >= reg.minInches;
  return {
    isLegal: legal,
    message: legal
      ? `${species} at ${lengthInches}" is legal. Minimum is ${reg.minInches}". Bag limit: ${reg.bagLimit}.`
      : `⚠️ ${species} at ${lengthInches}" is undersized. Minimum is ${reg.minInches}". Release it.`,
  };
}

export interface AgentResult {
  intent: Intent["type"];
  replyText: string;
  tripData?: {
    spotName: string;
    latitude: number;
    longitude: number;
    plannedDate: Date;
    targetSpecies: string | null;
    vizScore: number;
    vizSummary: string;
    conditionsSnapshot: object;
  };
  catchData?: {
    species: string;
    lengthInches: number | null;
    spotName: string | null;
    isLegal: boolean | null;
  };
}

export async function processMessage(
  userMessage: string,
): Promise<AgentResult> {
  console.log("[agent] processing:", userMessage);

  // parse intent
  // strictJsonSchema: false — Zod v4 emits anyOf for nullable fields which OpenAI's
  // Responses API strict mode rejects; non-strict mode accepts it fine
  const { object: intent } = await generateObject({
    model: openai("gpt-4o"),
    schema: IntentSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    system: `You are Viz, a spearfishing and dive planning assistant for Southern California.
Parse the user's message and extract structured intent.
For catch_log: extract species, size in inches, and spot name if mentioned.
For trip_plan: extract location, date, and target species if mentioned.
For regulation questions or general diving questions, set type to "question" and write a directReply.`,
    prompt: userMessage,
  });

  // trip planning flow
  if (intent.type === "trip_plan" && intent.location != null) {
    const geo = await geocodeLocation(intent.location);
    const targetDate = intent.date
      ? parseTargetDate(intent.date)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          return d;
        })();

    const conditions = await fetchConditions(
      geo.latitude,
      geo.longitude,
      targetDate,
    );
    const viz = computeVizScore(conditions);

    const dateLabel = targetDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // best window: center on low tide ±1.5hrs, but cap start at 6am
    const bestWindow = (() => {
      const low = conditions.tides.nextLow;
      if (!low) return 'dawn–9am';
      const lowHour = new Date(low.time).getHours();
      const start = Math.max(6, lowHour - 1);
      const end = Math.min(lowHour + 2, 11); // cap at 11am
      const fmt = (h: number) => `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
      return `${fmt(start)}–${fmt(end)}`;
    })();

    const tideLabel = conditions.tides.nextLow
      ? `Low tide ${new Date(conditions.tides.nextLow.time).getHours()}am ✓`
      : '';

    // show each negative factor, collapse all positives into one line
    const negatives = viz.factors
      .filter(f => f.impact === 'negative')
      .map(f => `✗ ${f.note}`);
    const positiveCount = viz.factors.filter(f => f.impact === 'positive').length;
    const positivesSummary = positiveCount > 0 ? `✓ Everything else looks clean` : '';

    const replyText = [
      `${geo.displayName} · ${dateLabel}`,
      `${viz.score}/10 ${viz.label} · ${viz.estVisibilityFt} viz · ${conditions.seaTempF}°F water`,
      `Best window: ${bestWindow}`,
      tideLabel,
      ``,
      ...negatives,
      positivesSummary,
      ``,
      `Reply "more" for full conditions`,
      `👍 for 5am update`,
    ]
      .filter(Boolean)
      .join("\n");

    console.log("[agent] reply:", replyText.slice(0, 100));

    return {
      intent: "trip_plan",
      replyText,
      tripData: {
        spotName: geo.displayName,
        latitude: geo.latitude,
        longitude: geo.longitude,
        plannedDate: targetDate,
        targetSpecies: intent.targetSpecies ?? null,
        vizScore: viz.score,
        vizSummary: viz.verdict,
        conditionsSnapshot: conditions,
      },
    };
  }

  // catch logging flow
  if (intent.type === "catch_log" && intent.species != null) {
    let legalityMsg = "";
    let isLegal: boolean | null = null;

    if (intent.lengthInches != null) {
      const check = checkLegality(intent.species, intent.lengthInches);
      legalityMsg = check.message;
      isLegal = check.isLegal;
    }

    const replyText = [
      `Logged: ${intent.species}${intent.lengthInches ? ` (${intent.lengthInches}")` : ""}${intent.spotName ? ` at ${intent.spotName}` : ""}.`,
      legalityMsg,
      `Reply "share" to post to your group.`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      intent: "catch_log",
      replyText,
      catchData: {
        species: intent.species,
        lengthInches: intent.lengthInches ?? null,
        spotName: intent.spotName ?? null,
        isLegal,
      },
    };
  }

  // question or fallback
  return {
    intent: intent.type,
    replyText:
      intent.directReply ??
      "Not sure what you're asking — try sending a dive spot and date, or log a catch.",
  };
}
