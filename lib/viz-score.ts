import type { ConditionsData } from './data/index';

export interface VizFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  note: string;
}

export interface VizScore {
  score: number;
  label: string;
  verdict: string;
  factors: VizFactor[];
  estVisibilityFt: string;
}

const FACTOR_ICON: Record<VizFactor['impact'], string> = {
  positive: '✅',
  negative: '❌',
  neutral: '➖',
};

export function factorIcon(impact: VizFactor['impact']): string {
  return FACTOR_ICON[impact];
}

export function formatFactorLine(f: VizFactor): string {
  return `${FACTOR_ICON[f.impact]} ${f.note}`;
}

export function formatFactorLines(factors: VizFactor[]): string {
  return factors.map(formatFactorLine).join('\n');
}

// visibility is driven by swell and runoff - the two things that actually
// murk up the water. wind and tide affect trip quality but not viz directly.
function estimateVisibility(swellFt: number, runoffStatus: string): string {
  if (runoffStatus === 'high' || swellFt >= 3) return '0-5ft';
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

  // under 2ft is ideal for viz, anything above 3ft starts stirring up the bottom
  const swellFt = conditions.swellFt;
  if (swellFt <= 1.5) {
    factors.push({
      name: 'Swell',
      impact: 'positive',
      note: `${swellFt}ft swell - flat, great viz`,
    });
  } else if (swellFt <= 2.5) {
    score -= 1;
    factors.push({
      name: 'Swell',
      impact: 'neutral',
      note: `${swellFt}ft swell - manageable`,
    });
  } else if (swellFt <= 4) {
    score -= 3;
    factors.push({
      name: 'Swell',
      impact: 'negative',
      note: `${swellFt}ft swell - moderate churn`,
    });
  } else {
    score -= 5;
    factors.push({
      name: 'Swell',
      impact: 'negative',
      note: `${swellFt}ft swell - rough conditions`,
    });
  }

  // longer swell periods = more powerful = more bottom disturbance even at the same height
  const periodS = conditions.marine.swellPeriodS;
  if (periodS >= 12) {
    score -= 1;
    factors.push({
      name: 'Swell period',
      impact: 'negative',
      note: `${periodS}s - long period, reaches deeper`,
    });
  }

  // offshore wind (blowing from land to sea) is great - clears the surface
  const windKts = conditions.marine.windSpeedKnots;
  const windDir = conditions.marine.windDirectionDeg;

  // "offshore" for SoCal is generally east/northeast (90-45 degrees)
  // this is a simplification but good enough for the score
  const isOffshore = windDir >= 30 && windDir <= 120;

  if (windKts < 5) {
    factors.push({
      name: 'Wind',
      impact: 'positive',
      note: `${windKts}kts wind - calm, great for viz`,
    });
  } else if (isOffshore && windKts < 15) {
    factors.push({
      name: 'Wind',
      impact: 'positive',
      note: `${windKts}kts wind offshore - pulling clear water up`,
    });
  } else if (windKts < 10) {
    score -= 1;
    factors.push({
      name: 'Wind',
      impact: 'neutral',
      note: `${windKts}kts wind - light onshore, minor impact`,
    });
  } else if (windKts < 20) {
    score -= 2;
    factors.push({
      name: 'Wind',
      impact: 'negative',
      note: `${windKts}kts wind onshore - surface chop`,
    });
  } else {
    score -= 3;
    factors.push({
      name: 'Wind',
      impact: 'negative',
      note: `${windKts}kts wind - strong, avoid`,
    });
  }

  // river runoff is a big one that nobody else factors in
  // high discharge after rain will tank viz for days
  const runoff = conditions.runoff;
  if (runoff.status === 'normal') {
    factors.push({
      name: 'Runoff',
      impact: 'positive',
      note: `Runoff (${runoff.siteName}) - clean`,
    });
  } else if (runoff.status === 'elevated') {
    score -= 2;
    factors.push({
      name: 'Runoff',
      impact: 'negative',
      note: `Runoff (${runoff.siteName}) - elevated, murky water likely`,
    });
  } else if (runoff.status === 'high') {
    score -= 4;
    factors.push({
      name: 'Runoff',
      impact: 'negative',
      note: `Runoff (${runoff.siteName}) - high discharge, avoid area`,
    });
  } else {
    factors.push({
      name: 'Runoff',
      impact: 'neutral',
      note: 'Runoff - no gauge data for this area',
    });
  }

  // low tide in the morning is the sweet spot
  // helps with viz since there's less water moving suspended particles around
  const nextLow = conditions.tides.nextLow;
  if (nextLow) {
    const lowHour = new Date(nextLow.time).getHours();
    if (lowHour >= 5 && lowHour <= 9) {
      factors.push({
        name: 'Tide',
        impact: 'positive',
        note: `Low tide at ${nextLow.time.split(' ')[1]} - morning low, ideal entry window`,
      });
    } else {
      factors.push({
        name: 'Tide',
        impact: 'neutral',
        note: `Low tide at ${nextLow.time.split(' ')[1]}`,
      });
    }
  }

  score = Math.max(1, score);

  const label = getLabel(score);
  const estVisibilityFt = estimateVisibility(swellFt, runoff.status);

  let verdict: string;
  if (score >= 8) {
    verdict = `${label} (${score}/10) - worth the trip. Est. viz ${estVisibilityFt}.`;
  } else if (score >= 6) {
    verdict = `${label} (${score}/10) - decent conditions. Est. viz ${estVisibilityFt}.`;
  } else if (score >= 4) {
    verdict = `${label} (${score}/10) - marginal. Check again tomorrow.`;
  } else {
    verdict = `${label} (${score}/10) - not worth it today.`;
  }

  return { score, label, verdict, factors, estVisibilityFt };
}
