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
