// Open-Meteo marine API - free, no key needed
// https://open-meteo.com/en/docs/marine-weather-api
// I picked this over Stormglass because it's actually free (no trial BS)

export interface MarineConditions {
  swellHeightM: number;
  swellPeriodS: number;
  swellDirectionDeg: number;
  windSpeedKnots: number;
  windDirectionDeg: number;
  seaTempC: number;
  fetchedAt: string;
}

function metersToFeet(m: number) {
  return Math.round(m * 3.281 * 10) / 10;
}

function msToKnots(ms: number) {
  return Math.round(ms * 1.944 * 10) / 10;
}

export function celsiusToFahrenheit(c: number) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

export function swellHeightFt(conditions: MarineConditions) {
  return metersToFeet(conditions.swellHeightM);
}

export function windSpeedKnots(conditions: MarineConditions) {
  return conditions.windSpeedKnots;
}

// grabs conditions for a specific date - we use 7am as the representative
// snapshot since that's the window most divers care about
export async function getMarineConditions(
  lat: number,
  lng: number,
  targetDate: Date,
): Promise<MarineConditions> {
  const dateStr = targetDate.toISOString().split("T")[0];

  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lng.toString());
  url.searchParams.set(
    "hourly",
    [
      "wave_height",
      "wave_period",
      "wave_direction",
      "wind_wave_height",
      "sea_surface_temperature",
    ].join(","),
  );
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);

  // wind comes from a separate endpoint - marine API doesn't include it
  const windUrl = new URL("https://api.open-meteo.com/v1/forecast");
  windUrl.searchParams.set("latitude", lat.toString());
  windUrl.searchParams.set("longitude", lng.toString());
  windUrl.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m");
  windUrl.searchParams.set("wind_speed_unit", "kn");
  windUrl.searchParams.set("start_date", dateStr);
  windUrl.searchParams.set("end_date", dateStr);

  const [marineRes, windRes] = await Promise.all([
    fetch(url.toString()),
    fetch(windUrl.toString()),
  ]);

  if (!marineRes.ok || !windRes.ok) {
    throw new Error("Failed to fetch marine/wind data from Open-Meteo");
  }

  const marine = await marineRes.json();
  const wind = await windRes.json();

  // index 7 = 7am local time
  const hour = 7;

  return {
    swellHeightM: marine.hourly.wave_height[hour] ?? 0,
    swellPeriodS: marine.hourly.wave_period[hour] ?? 0,
    swellDirectionDeg: marine.hourly.wave_direction[hour] ?? 0,
    windSpeedKnots: wind.hourly.wind_speed_10m[hour] ?? 0,
    windDirectionDeg: wind.hourly.wind_direction_10m[hour] ?? 0,
    seaTempC: marine.hourly.sea_surface_temperature[hour] ?? 0,
    fetchedAt: new Date().toISOString(),
  };
}
