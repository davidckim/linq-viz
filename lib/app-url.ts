const DEFAULT_APP_URL = 'https://linq-viz.vercel.app';

export function getAppUrl(): string {
  return process.env.APP_URL ?? DEFAULT_APP_URL;
}

export function getReportUrl(tripId: string): string {
  return `${getAppUrl()}/report/${tripId}`;
}

export function formatReportMessage(tripId: string): string {
  return `🤿 Full breakdown - ${getReportUrl(tripId)}`;
}
