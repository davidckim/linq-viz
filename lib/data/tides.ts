// NOAA tides API - official government data, free, no key
// https://api.tidesandcurrents.noaa.gov/api/prod/
// tried a few options, this is the most reliable for SoCal

import { haversineDistanceMiles } from './geo';
import { DATA_ENDPOINTS } from './endpoints';

export interface TidePrediction {
  time: string;
  heightFt: number;
  type: 'H' | 'L';
}

export interface TideData {
  stationName: string;
  predictions: TidePrediction[];
  nextLow: TidePrediction | null;
  nextHigh: TidePrediction | null;
}

// hardcoded the SoCal stations I care about. could make this dynamic
// but for the demo scope this is fine and easier to reason about
// station IDs from: https://tidesandcurrents.noaa.gov/stations.html
const SOCAL_STATIONS = [
  { id: '9410840', name: 'Santa Monica', lat: 34.008, lng: -118.498 },
  { id: '9410660', name: 'Los Angeles', lat: 33.72, lng: -118.272 },
  { id: '9410580', name: 'Newport Beach', lat: 33.608, lng: -117.878 },
  { id: '9410170', name: 'San Diego', lat: 32.714, lng: -117.174 },
  { id: '9410230', name: 'La Jolla', lat: 32.867, lng: -117.257 },
  { id: '9411340', name: 'Santa Barbara', lat: 34.408, lng: -119.685 },
];

function nearestStation(lat: number, lng: number) {
  let best = SOCAL_STATIONS[0];
  let bestDist = haversineDistanceMiles(lat, lng, best.lat, best.lng);
  for (const station of SOCAL_STATIONS.slice(1)) {
    const dist = haversineDistanceMiles(lat, lng, station.lat, station.lng);
    if (dist < bestDist) {
      best = station;
      bestDist = dist;
    }
  }
  return best;
}

export async function getTideData(
  lat: number,
  lng: number,
  targetDate: Date,
): Promise<TideData> {
  const station = nearestStation(lat, lng);
  const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');

  const url = new URL(DATA_ENDPOINTS.noaaTides);
  url.searchParams.set('begin_date', dateStr);
  url.searchParams.set('end_date', dateStr);
  url.searchParams.set('station', station.id);
  url.searchParams.set('product', 'predictions');
  url.searchParams.set('datum', 'MLLW');
  url.searchParams.set('time_zone', 'lst_ldt');
  url.searchParams.set('interval', 'hilo');
  url.searchParams.set('units', 'english');
  url.searchParams.set('application', 'viz_app');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NOAA tides API error: ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`NOAA error: ${data.error.message}`);

  const predictions: TidePrediction[] = (data.predictions ?? []).map(
    (raw: { t: string; v: string; type: string }) => ({
      time: raw.t,
      heightFt: parseFloat(raw.v),
      type: raw.type as 'H' | 'L',
    }),
  );

  const now = new Date();
  const upcoming = predictions.filter(
    (prediction) => new Date(prediction.time) > now,
  );

  return {
    stationName: station.name,
    predictions,
    nextLow: upcoming.find((prediction) => prediction.type === 'L') ?? null,
    nextHigh: upcoming.find((prediction) => prediction.type === 'H') ?? null,
  };
}
