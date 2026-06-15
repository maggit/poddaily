import {
  pgTable, uuid, text, boolean, timestamp, jsonb, unique,
} from "drizzle-orm/pg-core";
import type { Question, ReportAnswer } from "@poddaily/shared";

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slackChannelId: text("slack_channel_id").notNull().unique(),
  slackChannelName: text("slack_channel_name").notNull(),
  tribe: text("tribe"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackDisplayName: text("slack_display_name").notNull(),
  slackAvatarUrl: text("slack_avatar_url"),
  timezone: text("timezone"),
  canReport: boolean("can_report").default(true),
  canView: boolean("can_view").default(true),
  canEdit: boolean("can_edit").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqMember: unique().on(t.teamId, t.slackUserId) }));

export const standups = pgTable("standups", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).unique(),
  name: text("name").notNull().default("Daily Standup"),
  questions: jsonb("questions").$type<Question[]>().notNull(),
  scheduleCron: text("schedule_cron").notNull(),
  scheduleTz: text("schedule_tz").notNull().default("America/Mexico_City"),
  introMessage: text("intro_message"),
  outroMessage: text("outro_message"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const standupRuns = pgTable("standup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  standupId: uuid("standup_id").references(() => standups.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const standupReports = pgTable("standup_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => standupRuns.id),
  slackUserId: text("slack_user_id").notNull(),
  slackDisplayName: text("slack_display_name").notNull(),
  answers: jsonb("answers").$type<ReportAnswer[]>().notNull(),
  status: text("status").default("in_progress"),
  dmThreadTs: text("dm_thread_ts"),
  channelPostTs: text("channel_post_ts"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const slackUserTokens = pgTable("slack_user_tokens", {
  slackUserId: text("slack_user_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  scopes: text("scopes").notNull(),
  authedAt: timestamp("authed_at", { withTimezone: true }).defaultNow(),
});

export const standupReminders = pgTable("standup_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => standupRuns.id),
  slackUserId: text("slack_user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
  type: text("type").default("initial"),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type Standup = typeof standups.$inferSelect;
export type NewStandup = typeof standups.$inferInsert;
export type StandupRun = typeof standupRuns.$inferSelect;
export type NewStandupRun = typeof standupRuns.$inferInsert;
export type StandupReport = typeof standupReports.$inferSelect;
export type NewStandupReport = typeof standupReports.$inferInsert;
export type SlackUserToken = typeof slackUserTokens.$inferSelect;
export type NewSlackUserToken = typeof slackUserTokens.$inferInsert;
export type StandupReminder = typeof standupReminders.$inferSelect;
export type NewStandupReminder = typeof standupReminders.$inferInsert;
