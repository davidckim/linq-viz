# Viz

Spearfishing conditions over iMessage. Text a dive spot and a date, get a viz score and conditions report back.

Live demo: [linq-viz.vercel.app](https://linq-viz.vercel.app)

## What it does

Send a message like _"How are conditions at Malaga Cove this Saturday?"_ and Viz replies with:

- Viz score (1–10) and estimated visibility
- Swell, wind, sea temp
- Tide table and best dive window
- River runoff status (the thing most surf apps skip)
- MLPA legality check for the spot

Reply **deets** or react 👍 for a full dashboard link. Reply **remind me** to set a 5am alert for your dive day (cron not wired up yet).

## Stack

- [Next.js 16](https://nextjs.org) + TypeScript
- [Linq](https://linqapp.com) for iMessage
- [Neon](https://neon.tech) Postgres + [Drizzle ORM](https://orm.drizzle.team)
- [Vercel AI SDK](https://sdk.vercel.ai) + GPT-4o
- Open-Meteo, NOAA tides, USGS streamflow (all free, no keys)

## Getting started

```bash
npm install
# create .env.local with the variables below
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page. Point your Linq webhook at `/api/webhook`.

### Environment variables

| Variable                | What it's for                                                    |
| ----------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`          | Neon Postgres connection string                                  |
| `OPENAI_API_KEY`        | Intent parsing and geocoding                                     |
| `LINQ_API_KEY`          | Sending replies                                                  |
| `LINQ_WEBHOOK_SECRET`   | Verifying inbound webhooks                                       |
| `LINQ_PHONE_NUMBER`     | Shown on the landing page / QR code                              |
| `APP_URL`               | Base URL for dashboard links (defaults to production)            |

## Project layout

```
app/
  page.tsx                 Landing page + QR code
  api/webhook/route.ts     Linq webhook handler
  report/[tripId]/page.tsx Conditions dashboard
lib/
  agent.ts                 Message parsing + reply formatting
  viz-score.ts             Scoring logic
  data/                    Marine, tides, runoff fetchers
  db/schema.ts             Postgres tables
```

## Scripts

```bash
npm run dev          # local dev
npm run build        # production build
npm run db:push      # push schema to Neon
npm run db:studio    # Drizzle Studio
```

## Caveats

- **SoCal only** for accurate runoff. USGS gauges are mapped for Southern California rivers. Marine and tide data work elsewhere, but runoff won't.
- **Viz score is a heuristic**, not validated against real dive logs. Good for comparing days, not gospel.

Built as a technical challenge demo for Linq.
