// USGS streamflow data - free, no key
// https://waterservices.usgs.gov/
//
// This is the piece that makes Viz different from just reading a surf report.
// River discharge is the main reason SoCal water gets murky after rain
// the rivers carry sediment into the ocean and it takes days to clear.
// Nobody else is pulling this data for dive planning.

import { haversineDistanceMiles } from './geo';
import { DATA_ENDPOINTS } from './endpoints';

export interface RunoffData {
  siteName: string;
  currentCfs: number; // current cubic feet per second
  status: 'normal' | 'elevated' | 'high' | 'unknown';
  impactOnViz: string; // human-readable impact summary
}

// the gauges closest to spots I actually dive. could expand this
// site codes from: https://waterdata.usgs.gov/nwis
const SOCAL_GAUGES = [
  {
    siteCode: '11098000',
    name: 'Santa Monica Creek',
    lat: 34.028,
    lng: -118.467,
  },
  { siteCode: '11098500', name: 'Ballona Creek', lat: 33.983, lng: -118.432 },
  {
    siteCode: '11087020',
    name: 'San Gabriel River',
    lat: 33.776,
    lng: -118.113,
  },
  {
    siteCode: '11109400',
    name: 'LA River at Long Beach',
    lat: 33.774,
    lng: -118.188,
  },
  { siteCode: '11023000', name: 'San Diego River', lat: 32.757, lng: -117.196 },
];

function nearestGauge(lat: number, lng: number) {
  let best = SOCAL_GAUGES[0];
  let bestDist = haversineDistanceMiles(lat, lng, best.lat, best.lng);
  for (const gauge of SOCAL_GAUGES.slice(1)) {
    const dist = haversineDistanceMiles(lat, lng, gauge.lat, gauge.lng);
    if (dist < bestDist) {
      best = gauge;
      bestDist = dist;
    }
  }
  return best;
}

function classifyDischarge(cfs: number): RunoffData['status'] {
  // Thresholds based on typical SoCal dry-season baseline
  // In summer, anything above ~50 cfs is elevated for most SoCal rivers
  if (cfs < 10) return 'normal';
  if (cfs < 50) return 'elevated';
  return 'high';
}

function describeImpact(
  status: RunoffData['status'],
  siteName: string,
): string {
  switch (status) {
    case 'normal':
      return `${siteName} discharge is normal — minimal runoff impact on visibility.`;
    case 'elevated':
      return `${siteName} discharge is elevated — some sediment plume likely near river mouth. Avoid diving within 1 mile of river outlet.`;
    case 'high':
      return `${siteName} discharge is high — significant runoff. Visibility near the coast will be poor. Wait 48-72hrs after discharge drops.`;
    default:
      return `Could not retrieve discharge data for ${siteName}.`;
  }
}

export async function getRunoffData(
  lat: number,
  lng: number,
): Promise<RunoffData> {
  const gauge = nearestGauge(lat, lng);

  const url = new URL(DATA_ENDPOINTS.usgsStreamflow);
  url.searchParams.set('format', 'json');
  url.searchParams.set('sites', gauge.siteCode);
  url.searchParams.set('parameterCd', '00060');
  url.searchParams.set('siteStatus', 'active');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`USGS API error: ${res.status}`);

    const data = await res.json();
    const series = data?.value?.timeSeries?.[0];
    const latestValue = series?.values?.[0]?.value?.[0]?.value;

    if (!latestValue) {
      return {
        siteName: gauge.name,
        currentCfs: 0,
        status: 'unknown',
        impactOnViz: `No recent data available for ${gauge.name}.`,
      };
    }

    const cfs = parseFloat(latestValue);
    const status = classifyDischarge(cfs);

    return {
      siteName: gauge.name,
      currentCfs: cfs,
      status,
      impactOnViz: describeImpact(status, gauge.name),
    };
  } catch {
    return {
      siteName: gauge.name,
      currentCfs: 0,
      status: 'unknown',
      impactOnViz: `Could not retrieve runoff data for ${gauge.name}.`,
    };
  }
}
