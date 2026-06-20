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

export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: serial("id").primaryKey(),
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
    uniqueIndex("whatsapp_conversations_badge_number_idx").on(
      table.badgeNumber,
    ),
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

export const webParticipants = pgTable(
  "web_participants",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    lumaGuestId: text("luma_guest_id"),
    displayName: text("display_name"),
    approvalStatus: text("approval_status").notNull().default("approved"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("web_participants_email_idx").on(table.email)],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: serial("id").primaryKey(),
    webParticipantId: integer("web_participant_id")
      .notNull()
      .references(() => webParticipants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("otp_challenges_latest_email_idx").on(table.email, table.id),
  ],
);

export const webSessions = pgTable(
  "web_sessions",
  {
    id: serial("id").primaryKey(),
    webParticipantId: integer("web_participant_id")
      .notNull()
      .references(() => webParticipants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("web_sessions_token_hash_idx").on(table.tokenHash)],
);

export const webBadgeAttempts = pgTable("web_badge_attempts", {
  id: serial("id").primaryKey(),
  webParticipantId: integer("web_participant_id")
    .notNull()
    .references(() => webParticipants.id, { onDelete: "cascade" }),
  badgeNumber: integer("badge_number"),
  status: text("status").notNull().default("queued"),
  sourceImageUrl: text("source_image_url").notNull(),
  pixelArtImageUrl: text("pixel_art_image_url"),
  badgeImageUrl: text("badge_image_url"),
  generationRunId: text("generation_run_id"),
  generationError: text("generation_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const badges = pgTable(
  "badges",
  {
    id: serial("id").primaryKey(),
    badgeNumber: integer("badge_number").notNull(),
    sourceChannel: text("source_channel").notNull(),
    whatsappConversationId: integer("whatsapp_conversation_id").references(
      () => whatsappConversations.id,
      { onDelete: "set null" },
    ),
    webParticipantId: integer("web_participant_id").references(
      () => webParticipants.id,
      { onDelete: "set null" },
    ),
    webBadgeAttemptId: integer("web_badge_attempt_id").references(
      () => webBadgeAttempts.id,
      { onDelete: "set null" },
    ),
    participantDisplayName: text("participant_display_name"),
    participantEmail: text("participant_email"),
    sourceImageUrl: text("source_image_url"),
    pixelArtImageUrl: text("pixel_art_image_url"),
    badgeImageUrl: text("badge_image_url").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("badges_badge_number_idx").on(table.badgeNumber),
    uniqueIndex("badges_whatsapp_conversation_idx").on(
      table.whatsappConversationId,
    ),
    uniqueIndex("badges_web_participant_idx").on(table.webParticipantId),
    uniqueIndex("badges_web_badge_attempt_idx").on(table.webBadgeAttemptId),
  ],
);

export const whatsappConversationsRelations = relations(
  whatsappConversations,
  ({ many, one }) => ({
    messages: many(whatsappMessages),
    badge: one(badges),
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

export const webParticipantsRelations = relations(
  webParticipants,
  ({ many, one }) => ({
    otpChallenges: many(otpChallenges),
    sessions: many(webSessions),
    badgeAttempts: many(webBadgeAttempts),
    badge: one(badges),
  }),
);

export const otpChallengesRelations = relations(otpChallenges, ({ one }) => ({
  participant: one(webParticipants, {
    fields: [otpChallenges.webParticipantId],
    references: [webParticipants.id],
  }),
}));

export const webSessionsRelations = relations(webSessions, ({ one }) => ({
  participant: one(webParticipants, {
    fields: [webSessions.webParticipantId],
    references: [webParticipants.id],
  }),
}));

export const webBadgeAttemptsRelations = relations(
  webBadgeAttempts,
  ({ one }) => ({
    participant: one(webParticipants, {
      fields: [webBadgeAttempts.webParticipantId],
      references: [webParticipants.id],
    }),
    badge: one(badges),
  }),
);

export const badgesRelations = relations(badges, ({ one }) => ({
  whatsappConversation: one(whatsappConversations, {
    fields: [badges.whatsappConversationId],
    references: [whatsappConversations.id],
  }),
  webParticipant: one(webParticipants, {
    fields: [badges.webParticipantId],
    references: [webParticipants.id],
  }),
  webBadgeAttempt: one(webBadgeAttempts, {
    fields: [badges.webBadgeAttemptId],
    references: [webBadgeAttempts.id],
  }),
}));
