import type { ConditionsData } from './data/index';

export interface VizFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  note: string;
}

export interface VizScore {
  score: number;        // 1-10
  label: string;        // "Poor" | "Fair" | "Good" | "Very Good" | "Excellent"
  verdict: string;      // one-liner for the SMS reply
  factors: VizFactor[]; // what pushed the score up or down
  estVisibilityFt: string; // rough estimate like "5-10ft" or "20-30ft"
}

// visibility is driven by swell and runoff — the two things that actually
// murk up the water. wind and tide affect trip quality but not viz directly.
function estimateVisibility(swellFt: number, runoffStatus: string): string {
  if (runoffStatus === 'high') return '0-5ft';
  if (swellFt >= 5) return '0-5ft';
  if (swellFt >= 3) return '0-5ft';
  if (swellFt >= 2 || runoffStatus === 'elevated') return '5-10ft';
  if (swellFt >= 1) return '10-20ft';
  return '20-30ft+';
}

function getLabel(score: number): string {
  if (score <= 2) return 'Poor';
  if (score <= 4) return 'Fair';
  if (score <= 6) return 'Good';
  if (score <= 8) return 'Very Good';
  return 'Excellent';
}

// main scoring function
// starts at 10 and deducts based on bad conditions
// I find this easier to reason about than building up from 0
export function computeVizScore(conditions: ConditionsData): VizScore {
  let score = 10;
  const factors: VizFactor[] = [];

  // --- Swell ---
  // under 2ft is ideal for viz, anything above 3ft starts stirring up the bottom
  const swellFt = conditions.swellFt;
  if (swellFt <= 1.5) {
    factors.push({ name: 'Swell', impact: 'positive', note: `${swellFt}ft swell — flat, great viz` });
  } else if (swellFt <= 2.5) {
    score -= 1;
    factors.push({ name: 'Swell', impact: 'neutral', note: `${swellFt}ft swell — manageable` });
  } else if (swellFt <= 4) {
    score -= 3;
    factors.push({ name: 'Swell', impact: 'negative', note: `${swellFt}ft swell — expect 5-10ft viz` });
  } else {
    score -= 5;
    factors.push({ name: 'Swell', impact: 'negative', note: `${swellFt}ft swell — rough, expect 0-5ft viz` });
  }

  // --- Swell period ---
  // longer period = more powerful = more bottom disturbance even at the same height
  const periodS = conditions.marine.swellPeriodS;
  if (periodS >= 12) {
    // long period swell reaches the bottom more
    score -= 1;
    factors.push({ name: 'Swell period', impact: 'negative', note: `${periodS}s — long period, reaches deeper` });
  }

  // --- Wind ---
  // offshore wind (blowing from land to sea) is great — clears the surface
  // onshore wind piles up particulate and chop
  const windKts = conditions.marine.windSpeedKnots;
  const windDir = conditions.marine.windDirectionDeg;

  // "offshore" for SoCal is generally east/northeast (90-45 degrees)
  // this is a simplification but good enough for the score
  const isOffshore = windDir >= 30 && windDir <= 120;

  if (windKts < 5) {
    factors.push({ name: 'Wind', impact: 'positive', note: `${windKts}kts — calm, great for viz` });
  } else if (isOffshore && windKts < 15) {
    factors.push({ name: 'Wind', impact: 'positive', note: `${windKts}kts offshore — pulling clear water up` });
  } else if (windKts < 10) {
    score -= 1;
    factors.push({ name: 'Wind', impact: 'neutral', note: `${windKts}kts — light onshore, minor impact` });
  } else if (windKts < 20) {
    score -= 2;
    factors.push({ name: 'Wind', impact: 'negative', note: `${windKts}kts onshore — surface chop, some particulate` });
  } else {
    score -= 3;
    factors.push({ name: 'Wind', impact: 'negative', note: `${windKts}kts — strong wind, avoid` });
  }

  // --- River runoff ---
  // this is the big one that nobody else factors in
  // high discharge after rain will tank viz for days
  const runoff = conditions.runoff;
  if (runoff.status === 'normal') {
    factors.push({ name: 'Runoff', impact: 'positive', note: `${runoff.siteName} discharge normal — no sediment plume` });
  } else if (runoff.status === 'elevated') {
    score -= 2;
    factors.push({ name: 'Runoff', impact: 'negative', note: `${runoff.siteName} elevated (${Math.round(runoff.currentCfs)} cfs) — some murk near river mouth` });
  } else if (runoff.status === 'high') {
    score -= 4;
    factors.push({ name: 'Runoff', impact: 'negative', note: `${runoff.siteName} high discharge (${Math.round(runoff.currentCfs)} cfs) — significant murk, avoid area` });
  }

  // --- Tide ---
  // low tide in the morning is the sweet spot
  // helps with viz since there's less water moving suspended particles around
  const nextLow = conditions.tides.nextLow;
  if (nextLow) {
    const lowHour = new Date(nextLow.time).getHours();
    if (lowHour >= 5 && lowHour <= 9) {
      factors.push({ name: 'Tide', impact: 'positive', note: `Low tide at ${nextLow.time.split(' ')[1]} — morning low, ideal entry window` });
    } else {
      factors.push({ name: 'Tide', impact: 'neutral', note: `Low tide at ${nextLow.time.split(' ')[1]}` });
    }
  }

  // floor at 1
  score = Math.max(1, score);

  const label = getLabel(score);
  const estVisibilityFt = estimateVisibility(swellFt, runoff.status);

  const verdict = score >= 8
    ? `${label} (${score}/10) — worth the trip. Est. viz ${estVisibilityFt}.`
    : score >= 6
    ? `${label} (${score}/10) — decent conditions. Est. viz ${estVisibilityFt}.`
    : score >= 4
    ? `${label} (${score}/10) — marginal. Check again tomorrow.`
    : `${label} (${score}/10) — not worth it today.`;

  return { score, label, verdict, factors, estVisibilityFt };
}
