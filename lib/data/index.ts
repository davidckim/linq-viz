import {
  getMarineConditions,
  celsiusToFahrenheit,
  swellHeightFt,
} from './marine';
import { getTideData } from './tides';
import { getRunoffData } from './runoff';

import type { MarineConditions } from './marine';
import type { TideData, TidePrediction } from './tides';
import type { RunoffData } from './runoff';

export type { MarineConditions, TideData, TidePrediction, RunoffData };

export interface ConditionsData {
  marine: MarineConditions;
  tides: TideData;
  runoff: RunoffData;
  seaTempF: number;
  swellFt: number;
  fetchedAt: string;
}

export async function fetchConditions(
  lat: number,
  lng: number,
  targetDate: Date,
): Promise<ConditionsData> {
  const [marine, tides, runoff] = await Promise.all([
    getMarineConditions(lat, lng, targetDate),
    getTideData(lat, lng, targetDate),
    getRunoffData(lat, lng),
  ]);

  return {
    marine,
    tides,
    runoff,
    seaTempF: celsiusToFahrenheit(marine.seaTempC),
    swellFt: swellHeightFt(marine),
    fetchedAt: new Date().toISOString(),
  };
}
