import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { fetchConditions, type ConditionsData } from './data/index';
import { computeVizScore, formatFactorLines } from './viz-score';
import { checkMlpa } from './mlpa';
import { getBestDiveWindow } from './dive-window';

// California fish regulations - keeping this hardcoded for now
// would pull from CDFW API in a real version but their data isn't structured well
const REGS: Record<
  string,
  { minInches: number; bagLimit: number; season: string }
> = {
  'calico bass': { minInches: 12, bagLimit: 10, season: 'year-round' },
  'white seabass': { minInches: 28, bagLimit: 3, season: 'year-round' },
  yellowtail: { minInches: 24, bagLimit: 10, season: 'year-round' },
  halibut: { minInches: 22, bagLimit: 5, season: 'year-round' },
  sheephead: { minInches: 12, bagLimit: 5, season: 'year-round' },
  lingcod: { minInches: 22, bagLimit: 2, season: 'year-round' },
  rockfish: { minInches: 10, bagLimit: 10, season: 'year-round' },
};

const IntentSchema = z.object({
  type: z.enum(['trip_plan', 'catch_log', 'question', 'greeting', 'other']),
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
  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    output: Output.object({ schema: GeoSchema }),
    providerOptions: { openai: { strictJsonSchema: false } },
    prompt: `Return the latitude, longitude, and a clean display name for this SoCal dive location: "${location}". If it's a general area like "Malibu" use the center of the coastline there.`,
  });
  if (!output) throw new Error('Failed to geocode location');
  return output;
}

function getTodayPacificISO(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

function parseISODate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function tomorrowPacific(): Date {
  const iso = getTodayPacificISO();
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day + 1);
}

export function checkLegality(
  species: string,
  lengthInches: number,
): {
  isLegal: boolean;
  message: string;
} {
  const key = Object.keys(REGS).find((speciesKey) =>
    species.toLowerCase().includes(speciesKey),
  );
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
  intent: Intent['type'];
  replyText: string;
  tripData?: {
    spotName: string;
    latitude: number;
    longitude: number;
    plannedDate: Date;
    targetSpecies: string | null;
    vizScore: number;
    vizSummary: string;
    conditionsSnapshot: ConditionsData;
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
  console.log('[agent] processing:', userMessage);

  // parse intent
  // strictJsonSchema: false — Zod v4 emits anyOf for nullable fields which OpenAI's
  // Responses API strict mode rejects; non-strict mode accepts it fine
  const todayISO = getTodayPacificISO();

  const { output: intent } = await generateText({
    model: openai('gpt-4o'),
    output: Output.object({ schema: IntentSchema }),
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

  if (!intent) throw new Error('Failed to parse intent');

  if (intent.type === 'trip_plan' && intent.location != null) {
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

    const dateLabel = targetDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const bestWindow = getBestDiveWindow(conditions.tides.nextLow);

    const factorLines = formatFactorLines(viz.factors);

    const mlpaWarning = checkMlpa(geo.latitude, geo.longitude);

    const replyText = [
      `🤿 ${geo.displayName} · ${dateLabel}`,
      `🌊 ${viz.score}/10 ${viz.label} · ${viz.estVisibilityFt} viz · ${conditions.seaTempF}°F`,
      `⏰ Best window: ${bestWindow}`,
      '',
      factorLines,
      '',
      mlpaWarning,
      '',
      'Reply "deets" or react 👍 for full breakdown',
      'Reply "remind me" for 5am update',
    ].join('\n');

    console.log('[agent] reply:', replyText.slice(0, 100));

    return {
      intent: 'trip_plan',
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
  if (intent.type === 'catch_log' && intent.species != null) {
    let legalityMsg = '';
    let isLegal: boolean | null = null;

    if (intent.lengthInches != null) {
      const check = checkLegality(intent.species, intent.lengthInches);
      legalityMsg = check.message;
      isLegal = check.isLegal;
    }

    const replyText = [
      `Logged: ${intent.species}${intent.lengthInches ? ` (${intent.lengthInches}")` : ''}${intent.spotName ? ` at ${intent.spotName}` : ''}.`,
      legalityMsg,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      intent: 'catch_log',
      replyText,
      catchData: {
        species: intent.species,
        lengthInches: intent.lengthInches ?? null,
        spotName: intent.spotName ?? null,
        isLegal,
      },
    };
  }

  if (intent.type === 'greeting') {
    return {
      intent: 'greeting',
      replyText: [
        "Hey! 🤿 I'm Viz - spearfishing conditions over text.",
        '',
        "Send me a dive spot and date and I'll send back:",
        '• Viz score (1–10)',
        '• Swell, wind & sea temp',
        '• Best entry window',
        '• Tide & runoff conditions',
        '• MLPA legality for the spot',
        '',
        'After a report, reply "deets" or react 👍 for the full dashboard, or "remind me" for a 5am update.',
        '',
        'Example: "How\'s Malaga Cove this Thursday?"',
      ].join('\n'),
    };
  }

  // question or fallback
  return {
    intent: intent.type,
    replyText:
      intent.directReply ?? 'Try sending a dive spot and date, or log a catch.',
  };
}
