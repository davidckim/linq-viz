import type { TidePrediction } from './data/tides';

function toAmPm(hour: number): string {
  return new Date(2000, 0, 1, hour)
    .toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
    .toLowerCase()
    .replace(' ', '');
}

export function getBestDiveWindow(nextLow: TidePrediction | null): string {
  if (!nextLow) return 'dawn–9am';
  const lowHour = new Date(nextLow.time).getHours();
  const start = Math.max(0, lowHour - 1);
  const end = Math.min(start + 3, 23);
  return `${toAmPm(start)}–${toAmPm(end)}`;
}
