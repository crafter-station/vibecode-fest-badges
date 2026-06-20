import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const badges = pgTable(
  "badges",
  {
    id: serial("id").primaryKey(),
    badgeNumber: integer("badge_number").notNull(),
    origin: text("origin").notNull(),
    sourceImageUrl: text("source_image_url"),
    pixelArtImageUrl: text("pixel_art_image_url"),
    badgeImageUrl: text("badge_image_url"),
    generationStatus: text("generation_status").notNull().default("allocated"),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("badges_badge_number_idx").on(table.badgeNumber)],
);

export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: serial("id").primaryKey(),
    badgeId: integer("badge_id").references(() => badges.id, {
      onDelete: "set null",
    }),
    waId: text("wa_id").notNull(),
    phoneNumber: text("phone_number").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    kapsoConversationId: text("kapso_conversation_id"),
    contactName: text("contact_name"),
    badgeNumber: integer("badge_number"),
    sourceImageUrl: text("source_image_url"),
    pixelArtImageUrl: text("pixel_art_image_url"),
    badgeImageUrl: text("badge_image_url"),
    badgeGenerationStarted: boolean("badge_generation_started")
      .notNull()
      .default(false),
    badgeGenerated: boolean("badge_generated").notNull().default(false),
    badgeGenerationRunId: text("badge_generation_run_id"),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    badgeGeneratedAt: timestamp("badge_generated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("whatsapp_conversations_wa_id_idx").on(table.waId),
    uniqueIndex("whatsapp_conversations_badge_id_idx").on(table.badgeId),
    uniqueIndex("whatsapp_conversations_badge_number_idx").on(
      table.badgeNumber,
    ),
  ],
);

export const webParticipants = pgTable(
  "web_participants",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    lumaGuestId: text("luma_guest_id"),
    lumaApprovalStatus: text("luma_approval_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("web_participants_email_idx").on(table.email)],
);

export const webOtpCodes = pgTable("web_otp_codes", {
  id: serial("id").primaryKey(),
  webParticipantId: integer("web_participant_id")
    .notNull()
    .references(() => webParticipants.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webSessions = pgTable("web_sessions", {
  id: serial("id").primaryKey(),
  webParticipantId: integer("web_participant_id")
    .notNull()
    .references(() => webParticipants.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webBadgeRequests = pgTable(
  "web_badge_requests",
  {
    id: serial("id").primaryKey(),
    webParticipantId: integer("web_participant_id")
      .notNull()
      .references(() => webParticipants.id, { onDelete: "cascade" }),
    badgeId: integer("badge_id").references(() => badges.id, {
      onDelete: "set null",
    }),
    sourceImageUrl: text("source_image_url"),
    pixelArtImageUrl: text("pixel_art_image_url"),
    badgeImageUrl: text("badge_image_url"),
    status: text("status").notNull().default("pending"),
    triggerRunId: text("trigger_run_id"),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("web_badge_requests_participant_idx").on(
      table.webParticipantId,
    ),
    uniqueIndex("web_badge_requests_badge_id_idx").on(table.badgeId),
  ],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: serial("id").primaryKey(),
    whatsappConversationId: integer("whatsapp_conversation_id")
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: "cascade" }),
    kapsoMessageId: text("kapso_message_id").notNull(),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull(),
    content: text("content"),
    mediaUrl: text("media_url"),
    rawPayload: jsonb("raw_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_messages_kapso_message_id_idx").on(
      table.kapsoMessageId,
    ),
  ],
);

export const whatsappConversationsRelations = relations(
  whatsappConversations,
  ({ many }) => ({
    messages: many(whatsappMessages),
  }),
);

export const whatsappMessagesRelations = relations(
  whatsappMessages,
  ({ one }) => ({
    conversation: one(whatsappConversations, {
      fields: [whatsappMessages.whatsappConversationId],
      references: [whatsappConversations.id],
    }),
  }),
);
