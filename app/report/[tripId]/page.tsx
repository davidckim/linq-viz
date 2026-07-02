import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { trips } from "@/lib/db/schema";
import type { ConditionsData } from "@/lib/data/index";
import { computeVizScore } from "@/lib/viz-score";
import { Card, CardContent } from "@/components/ui/card";

function degToCompass(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function toAmPm(hour: number) {
  return new Date(2000, 0, 1, hour)
    .toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
    .toLowerCase()
    .replace(" ", "");
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-pixel text-[7px] text-white/30 tracking-widest px-1">
      {children}
    </p>
  );
}

const runoffBadgeClass: Record<string, string> = {
  normal: "bg-emerald-500/20 text-emerald-400",
  elevated: "bg-yellow-500/20 text-yellow-400",
  high: "bg-red-500/20 text-red-400",
};

const factorIcon: Record<string, string> = {
  positive: "✅",
  negative: "❌",
  neutral: "➖",
};

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
        <p className="font-pixel text-[7px] text-white/40 tracking-widest">
          {label}
        </p>
        <p className="font-barlow text-xl font-semibold text-white">{value}</p>
        {sub && <p className="font-pixel text-[7px] text-white/40">{sub}</p>}
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

  const dateLabel = new Date(trip.plannedDate + "T12:00:00").toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
    },
  );

  function scoreColor(s: number) {
    if (s >= 8) return "text-emerald-400";
    if (s >= 6) return "text-yellow-400";
    if (s >= 4) return "text-orange-400";
    return "text-red-400";
  }

  function scoreGlow(s: number) {
    if (s >= 8) return "drop-shadow-[0_0_20px_rgba(52,211,153,0.6)]";
    if (s >= 6) return "drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]";
    return "drop-shadow-[0_0_20px_rgba(251,146,60,0.5)]";
  }

  const bestWindow = (() => {
    const low = tides.nextLow;
    if (!low) return "6am–9am";
    const lowHour = new Date(low.time).getHours();
    const start = Math.max(6, lowHour - 1);
    const end = Math.min(lowHour + 2, 11);
    return `${toAmPm(start)}–${toAmPm(end)}`;
  })();

  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${trip.longitude - 0.06},${trip.latitude - 0.04},${trip.longitude + 0.06},${trip.latitude + 0.04}&layer=mapnik&marker=${trip.latitude},${trip.longitude}`;

  return (
    <div className="min-h-screen pb-16">
      <div className="mx-auto max-w-md px-4 pt-10 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="font-pixel text-[8px] text-white/30 tracking-widest">
            VIZ REPORT
          </p>
          <h1 className="font-pixel text-lg text-white leading-relaxed">
            {trip.spotName.toUpperCase()}
          </h1>
          <p className="font-pixel text-[8px] text-white/40">
            {dateLabel.toUpperCase()}
          </p>
        </div>

        <Card>
          <CardContent className="flex items-center justify-between pt-5 pb-5">
            <div className="flex flex-col gap-1">
              <p className="font-pixel text-[7px] text-white/40">VIZ SCORE</p>
              <div className="flex items-end gap-1">
                <span
                  className={`font-pixel text-6xl ${scoreColor(viz.score)} ${scoreGlow(viz.score)}`}
                >
                  {viz.score}
                </span>
                <span className="font-pixel text-white/30 text-sm mb-2">
                  /10
                </span>
              </div>
            </div>
            <div className="text-right flex flex-col gap-2">
              <p className={`font-pixel text-sm ${scoreColor(viz.score)}`}>
                {viz.label.toUpperCase()}
              </p>
              <p className="font-pixel text-[8px] text-white/40">
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

        <div className="flex flex-col gap-2">
          <SectionLabel>KEY CONDITIONS</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="WATER TEMP" value={`${conditions.seaTempF}°F`} />
            <StatCard label="EST. VISIBILITY" value={viz.estVisibilityFt} />
            <div className="col-span-2">
              <StatCard label="BEST DIVE WINDOW" value={bestWindow} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>SWELL &amp; WIND</SectionLabel>
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
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>TIDES · {tides.stationName.toUpperCase()}</SectionLabel>
          <Card>
            <CardContent className="p-0">
              {tides.predictions.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-5 py-3 ${
                    i < tides.predictions.length - 1
                      ? "border-b border-white/5"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {p.type === "L" ? "↓" : "↑"}
                    </span>
                    <span className="font-pixel text-[7px] text-white/50">
                      {p.type === "L" ? "LOW" : "HIGH"}
                    </span>
                  </div>
                  <span className="font-barlow text-sm text-white/80">
                    {p.time.split(" ")[1]}
                  </span>
                  <span
                    className={`font-barlow font-semibold text-sm ${
                      p.type === "L" ? "text-sky-400" : "text-amber-400"
                    }`}
                  >
                    {p.heightFt.toFixed(1)}ft
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>RIVER RUNOFF</SectionLabel>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center justify-between">
                <p className="font-barlow text-sm font-medium text-white">
                  {runoff.siteName}
                </p>
                <span
                  className={`font-pixel text-[7px] px-2 py-1 rounded-full ${runoffBadgeClass[runoff.status] ?? "bg-white/10 text-white/40"}`}
                >
                  {runoff.status.toUpperCase()}
                </span>
              </div>
              <p className="font-barlow text-xs text-white/50 leading-relaxed">
                {runoff.impactOnViz}
              </p>
              {runoff.currentCfs > 0 && (
                <p className="font-pixel text-[7px] text-white/30">
                  {runoff.currentCfs} CFS
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>SCORE BREAKDOWN</SectionLabel>
          <Card>
            <CardContent className="p-0">
              {viz.factors.map((f, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-5 py-3 ${
                    i < viz.factors.length - 1 ? "border-b border-white/5" : ""
                  }`}
                >
                  <span className="text-base mt-0.5">{factorIcon[f.impact]}</span>
                  <p className="font-barlow text-sm text-white/70 leading-snug">
                    {f.note}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
