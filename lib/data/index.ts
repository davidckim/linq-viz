import {
  getMarineConditions,
  celsiusToFahrenheit,
  swellHeightFt,
} from "./marine";
import { getTideData } from "./tides";
import { getRunoffData } from "./runoff";

import type { MarineConditions } from "./marine";
import type { TideData } from "./tides";
import type { RunoffData } from "./runoff";

export type { MarineConditions } from "./marine";
export type { TideData, TidePrediction } from "./tides";
export type { RunoffData } from "./runoff";

export interface ConditionsData {
  marine: MarineConditions;
  tides: TideData;
  runoff: RunoffData;
  seaTempF: number;
  swellFt: number;
  fetchedAt: string;
}

// fetch all conditions data in parallel for a given location and date
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
