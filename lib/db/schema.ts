import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  integer,
  real,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const tripStatusEnum = pgEnum('trip_status', ['planned', 'completed', 'cancelled']);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: text('phone_number').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  linqEventId: text('linq_event_id').unique(),
  direction: messageDirectionEnum('direction').notNull(),
  body: text('body').notNull(),
  hasMedia: boolean('has_media').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  spotName: text('spot_name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  plannedDate: text('planned_date').notNull(),
  targetSpecies: text('target_species'),
  status: tripStatusEnum('status').default('planned').notNull(),
  conditionsSnapshot: jsonb('conditions_snapshot'),
  vizScore: integer('viz_score'),
  vizSummary: text('viz_summary'),
  alarmSet: boolean('alarm_set').default(false),
  alarmSentAt: timestamp('alarm_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const catches = pgTable('catches', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  tripId: uuid('trip_id').references(() => trips.id),
  species: text('species').notNull(),
  lengthInches: real('length_inches'),
  weightLbs: real('weight_lbs'),
  spotName: text('spot_name'),
  isLegal: boolean('is_legal'),
  sharedToGroup: boolean('shared_to_group').default(false),
  notes: text('notes'),
  caughtAt: timestamp('caught_at').defaultNow().notNull(),
});

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  type: text('type').notNull(),
  tripId: uuid('trip_id').references(() => trips.id),
  vizThreshold: integer('viz_threshold'),
  spotName: text('spot_name'),
  fireAt: timestamp('fire_at'),
  fired: boolean('fired').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
