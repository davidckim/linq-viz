import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { fetchConditions } from "./data/index";
import { computeVizScore } from "./viz-score";
import { haversineDistanceMiles } from "./data/geo";

// SoCal MLPA zones where spearfishing is restricted or banned
// Source: wildlife.ca.gov/Conservation/Marine/MPAs
// type "no-take" = all take prohibited; "restricted" = some species/methods restricted
const MLPA_ZONES = [
  { name: "La Jolla SMR", lat: 32.835, lng: -117.285, type: "no-take" },
  { name: "La Jolla SMCA", lat: 32.853, lng: -117.272, type: "restricted" },
  { name: "South La Jolla SMR", lat: 32.775, lng: -117.267, type: "no-take" },
  { name: "Swami's SMCA", lat: 33.038, lng: -117.295, type: "restricted" },
  { name: "Laguna Beach SMCA", lat: 33.542, lng: -117.782, type: "restricted" },
  { name: "Point Dume SMCA", lat: 34.003, lng: -118.807, type: "restricted" },
  { name: "Leo Carrillo SMCA", lat: 34.046, lng: -118.938, type: "restricted" },
  { name: "Anacapa Island SMR", lat: 34.01, lng: -119.36, type: "no-take" },
] as const;

function checkMlpa(lat: number, lng: number): string | null {
  for (const zone of MLPA_ZONES) {
    if (haversineDistanceMiles(lat, lng, zone.lat, zone.lng) <= 2) {
      return zone.type === "no-take"
        ? `⛔ ${zone.name} is a no-take MPA — spearfishing is prohibited here.`
        : `⚠️ ${zone.name} is a restricted MPA — verify species rules at wildlife.ca.gov before diving.`;
    }
  }
  return null;
}

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

const IntentSchema = z.object({
  type: z.enum(["trip_plan", "catch_log", "question", "greeting", "other"]),
  location: z.string().nullable(),
  date: z.string().nullable(),
  targetSpecies: z.string().nullable(),
  species: z.string().nullable(),
  lengthInches: z.number().nullable(),
  spotName: z.string().nullable(),
  directReply: z.string().nullable(),
});

type Intent = z.infer<typeof IntentSchema>;

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

function getTodayPacificISO(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

function parseISODate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function tomorrowPacific(): Date {
  const iso = getTodayPacificISO();
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day + 1);
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
  const todayISO = getTodayPacificISO();

  const { object: intent } = await generateObject({
    model: openai("gpt-4o"),
    schema: IntentSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    system: `You are Viz, a spearfishing and dive planning assistant for Southern California.
Today's date is ${todayISO} (Pacific time).
Parse the user's message and extract structured intent.
For catch_log: extract species, size in inches, and spot name if mentioned.
For trip_plan: extract location, date, and target species if mentioned. Resolve relative dates like "this Saturday" or "tomorrow" to a YYYY-MM-DD string based on today's date.
For regulation questions or general diving questions, set type to "question" and write a directReply.
For greetings like "hey", "hello", "hey viz", "hi" — set type to "greeting".`,
    prompt: userMessage,
  });

  // trip planning flow
  if (intent.type === "trip_plan" && intent.location != null) {
    const geo = await geocodeLocation(intent.location);
    const targetDate = intent.date
      ? parseISODate(intent.date)
      : tomorrowPacific();

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

    const toAmPm = (hour: number) =>
      new Date(2000, 0, 1, hour)
        .toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
        .toLowerCase()
        .replace(" ", "");

    const bestWindow = (() => {
      const low = conditions.tides.nextLow;
      if (!low) return "dawn–9am";
      const lowHour = new Date(low.time).getHours();
      const start = Math.max(6, lowHour - 1);
      const end = Math.min(lowHour + 2, 11);
      return `${toAmPm(start)}–${toAmPm(end)}`;
    })();

    const factorLines = viz.factors
      .map((f) =>
        f.impact === "negative"
          ? `❌ ${f.note}`
          : f.impact === "positive"
            ? `✅ ${f.note}`
            : `➖ ${f.note}`,
      )
      .join("\n");

    const mlpaWarning = checkMlpa(geo.latitude, geo.longitude);

    const replyText = [
      // section 1 — location + score
      `🤿 ${geo.displayName} · ${dateLabel}`,
      `🌊 ${viz.score}/10 ${viz.label} · ${viz.estVisibilityFt} viz · ${conditions.seaTempF}°F`,
      `⏰ Best window: ${bestWindow}`,
      ``,
      // section 2 — factors
      factorLines,
      ``,
      // section 3 — MLPA warning if applicable
      ...(mlpaWarning ? [mlpaWarning, ``] : []),
      // section 4 — actions
      `Reply "more" for full breakdown`,
      `👍 for 5am update`,
    ].join("\n");

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

  // greeting
  if (intent.type === "greeting") {
    return {
      intent: "greeting",
      replyText: [
        `Hey! 🤿 I'm Viz — spearfishing conditions over text.`,
        ``,
        `Send me a dive spot and date and I'll send back:`,
        `• Viz score (1–10)`,
        `• Swell, wind & sea temp`,
        `• Best entry window`,
        `• Tide & runoff conditions`,
        `• MLPA legality for the spot`,
        ``,
        `Example: "How's La Jolla Cove this Thursday?"`,
      ].join("\n"),
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
