import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trips } from '@/lib/db/schema';
import type { ConditionsData } from '@/lib/data/index';
import { computeVizScore, factorIcon } from '@/lib/viz-score';
import { Card, CardContent } from '@/components/ui/card';
import { checkMlpa } from '@/lib/mlpa';
import { getBestDiveWindow } from '@/lib/dive-window';
import { cn } from '@/lib/utils';

function degToCompass(deg: number) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

const SCORE_STYLES = [
  { min: 8, text: 'text-emerald-400', glow: 'drop-shadow-[0_0_20px_rgba(52,211,153,0.6)]' },
  { min: 6, text: 'text-yellow-400', glow: 'drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]' },
  { min: 4, text: 'text-orange-400', glow: 'drop-shadow-[0_0_20px_rgba(251,146,60,0.5)]' },
  { min: 0, text: 'text-red-400', glow: 'drop-shadow-[0_0_20px_rgba(251,146,60,0.5)]' },
] as const;

function getScoreStyle(score: number) {
  return SCORE_STYLES.find((style) => score >= style.min) ?? SCORE_STYLES[SCORE_STYLES.length - 1];
}

const runoffBadgeClass: Record<string, string> = {
  normal: 'bg-emerald-500/20 text-emerald-400',
  elevated: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-red-500/20 text-red-400',
};

function ReportSection({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="report-section">
      <p className="text-pixel-section">{label}</p>
      {children}
    </div>
  );
}

function ListRow({
  border,
  className,
  children,
}: {
  border?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('px-5 py-3', border && 'border-b border-white/5', className)}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <p className="text-pixel-label">{label}</p>
        <p className="font-barlow text-xl font-semibold text-white">{value}</p>
        {sub && <p className="text-pixel-label">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });

  if (!trip) notFound();

  const conditions = trip.conditionsSnapshot as ConditionsData | null;

  if (!conditions) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="font-pixel text-white/40 text-[10px] text-center leading-loose">
          CONDITIONS DATA
          <br />
          NOT AVAILABLE
        </p>
      </div>
    );
  }

  const viz = computeVizScore(conditions);
  const { marine, tides, runoff } = conditions;
  const scoreStyle = getScoreStyle(viz.score);

  const dateLabel = new Date(trip.plannedDate + 'T12:00:00').toLocaleDateString(
    'en-US',
    {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    },
  );

  const bestWindow = getBestDiveWindow(tides.nextLow);
  const mlpaWarning = checkMlpa(trip.latitude, trip.longitude);

  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${trip.longitude - 0.06},${trip.latitude - 0.04},${trip.longitude + 0.06},${trip.latitude + 0.04}&layer=mapnik&marker=${trip.latitude},${trip.longitude}`;

  return (
    <div className="min-h-screen pb-16">
      <div className="report-shell">
        <div className="report-section">
          <p className="text-pixel-overline">VIZ REPORT</p>
          <h1 className="font-pixel text-lg text-white leading-relaxed">
            {trip.spotName.toUpperCase()}
          </h1>
          <p className="text-pixel-caption">{dateLabel.toUpperCase()}</p>
        </div>

        <Card>
          <CardContent className="flex items-center justify-between pt-5 pb-5">
            <div className="flex flex-col gap-1">
              <p className="text-pixel-label">VIZ SCORE</p>
              <div className="flex items-end gap-1">
                <span
                  className={cn(
                    'font-pixel text-6xl',
                    scoreStyle.text,
                    scoreStyle.glow,
                  )}
                >
                  {viz.score}
                </span>
                <span className="font-pixel text-white/30 text-sm mb-2">
                  /10
                </span>
              </div>
            </div>
            <div className="text-right flex flex-col gap-2">
              <p className={cn('font-pixel text-sm', scoreStyle.text)}>
                {viz.label.toUpperCase()}
              </p>
              <p className="text-pixel-caption">
                EST. {viz.estVisibilityFt.toUpperCase()} VIZ
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden h-44 p-0">
          <iframe
            src={mapSrc}
            className="w-full h-full"
            loading="lazy"
            title={`Map of ${trip.spotName}`}
          />
        </Card>

        <ReportSection label="KEY CONDITIONS">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="WATER TEMP" value={`${conditions.seaTempF}°F`} />
            <StatCard label="EST. VISIBILITY" value={viz.estVisibilityFt} />
            <div className="col-span-2">
              <StatCard label="BEST DIVE WINDOW" value={bestWindow} />
            </div>
          </div>
        </ReportSection>

        <ReportSection label="SWELL &amp; WIND">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="SWELL"
              value={`${conditions.swellFt}ft`}
              sub={`${marine.swellPeriodS}s · ${degToCompass(marine.swellDirectionDeg)}`}
            />
            <StatCard
              label="WIND"
              value={`${marine.windSpeedKnots}kts`}
              sub={degToCompass(marine.windDirectionDeg)}
            />
          </div>
        </ReportSection>

        <ReportSection label={`TIDES · ${tides.stationName.toUpperCase()}`}>
          <Card>
            <CardContent className="p-0">
              {tides.predictions.map((prediction, index) => (
                <ListRow
                  key={prediction.time}
                  border={index < tides.predictions.length - 1}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {prediction.type === 'L' ? '↓' : '↑'}
                    </span>
                    <span className="text-pixel-meta">
                      {prediction.type === 'L' ? 'LOW' : 'HIGH'}
                    </span>
                  </div>
                  <span className="font-barlow text-sm text-white/80">
                    {prediction.time.split(' ')[1]}
                  </span>
                  <span
                    className={cn(
                      'font-barlow font-semibold text-sm',
                      prediction.type === 'L' ? 'text-sky-400' : 'text-amber-400',
                    )}
                  >
                    {prediction.heightFt.toFixed(1)}ft
                  </span>
                </ListRow>
              ))}
            </CardContent>
          </Card>
        </ReportSection>

        <ReportSection label="RIVER RUNOFF">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center justify-between">
                <p className="font-barlow text-sm font-medium text-white">
                  {runoff.siteName}
                </p>
                <span
                  className={cn(
                    'text-pixel-label rounded-full px-2 py-1',
                    runoffBadgeClass[runoff.status] ??
                      'bg-white/10 text-white/40',
                  )}
                >
                  {runoff.status.toUpperCase()}
                </span>
              </div>
              <p className="text-barlow-muted">{runoff.impactOnViz}</p>
              {runoff.currentCfs > 0 && (
                <p className="font-pixel text-[7px] text-white/30">
                  {runoff.currentCfs} CFS
                </p>
              )}
            </CardContent>
          </Card>
        </ReportSection>

        <ReportSection label="MLPA STATUS">
          <Card>
            <CardContent className="pt-4">
              <p className="text-barlow-body">{mlpaWarning}</p>
            </CardContent>
          </Card>
        </ReportSection>

        <ReportSection label="SCORE BREAKDOWN">
          <Card>
            <CardContent className="p-0">
              {viz.factors.map((factor, index) => (
                <ListRow
                  key={factor.name}
                  border={index < viz.factors.length - 1}
                  className="flex items-start gap-3"
                >
                  <span className="text-base mt-0.5">{factorIcon(factor.impact)}</span>
                  <p className="font-barlow text-sm text-white/70 leading-snug">
                    {factor.note}
                  </p>
                </ListRow>
              ))}
            </CardContent>
          </Card>
        </ReportSection>
      </div>
    </div>
  );
}
