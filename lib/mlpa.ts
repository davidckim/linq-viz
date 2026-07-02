import { haversineDistanceMiles } from "./data/geo";

const MLPA_ZONES = [
  { name: "La Jolla SMR",       lat: 32.835, lng: -117.285, type: "no-take" },
  { name: "La Jolla SMCA",      lat: 32.853, lng: -117.272, type: "restricted" },
  { name: "South La Jolla SMR", lat: 32.775, lng: -117.267, type: "no-take" },
  { name: "Swami's SMCA",       lat: 33.038, lng: -117.295, type: "restricted" },
  { name: "Laguna Beach SMCA",  lat: 33.542, lng: -117.782, type: "restricted" },
  { name: "Point Dume SMCA",    lat: 34.003, lng: -118.807, type: "restricted" },
  { name: "Leo Carrillo SMCA",  lat: 34.046, lng: -118.938, type: "restricted" },
  { name: "Anacapa Island SMR", lat: 34.01,  lng: -119.36,  type: "no-take" },
] as const;

export function checkMlpa(lat: number, lng: number): string | null {
  for (const zone of MLPA_ZONES) {
    if (haversineDistanceMiles(lat, lng, zone.lat, zone.lng) <= 2) {
      return zone.type === "no-take"
        ? `⛔ ${zone.name} is a no-take MPA — spearfishing is prohibited here.`
        : `⚠️ ${zone.name} is a restricted MPA — verify species rules at wildlife.ca.gov before diving.`;
    }
  }
  return null;
}
