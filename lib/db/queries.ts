import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trips } from '@/lib/db/schema';

export async function getRecentTrip(conversationId: string) {
  return db.query.trips.findFirst({
    where: eq(trips.conversationId, conversationId),
    orderBy: (trip, { desc }) => [desc(trip.createdAt)],
  });
}
