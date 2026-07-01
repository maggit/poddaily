import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, jsonb, unique, date, integer,
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
  reminderIntervalMinutes: integer("reminder_interval_minutes").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const standupRuns = pgTable("standup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  standupId: uuid("standup_id").references(() => standups.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").default("pending"),
  channelOpeningTs: text("channel_opening_ts"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqRunPerDay: unique().on(t.standupId, t.scheduledDate) }));

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
  timeoutAt: timestamp("timeout_at", { withTimezone: true }),
}, (t) => ({ uniqReportPerMember: unique().on(t.runId, t.slackUserId) }));

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

export const userRole = pgEnum("user_role", ["viewer", "manager", "admin"]);

export const appUsers = pgTable("app_users", {
  slackUserId: text("slack_user_id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const teamManagers = pgTable("team_managers", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull().references(() => appUsers.slackUserId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqTeamManager: unique().on(t.teamId, t.slackUserId) }));

// A synced snapshot of the Slack workspace member directory, refreshed by the worker
// (users.list, fully paginated). Backs the member-search autocomplete so search is local,
// complete, and fast — Slack has no users.search API. A trigram GIN search index over the
// name/email expression is added out-of-band in the migration (not expressible in Drizzle).
export const slackDirectoryUsers = pgTable("slack_directory_users", {
  slackUserId: text("slack_user_id").primaryKey(),
  displayName: text("display_name"),
  realName: text("real_name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  tz: text("tz"),
  isBot: boolean("is_bot").notNull().default(false),
  deleted: boolean("deleted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Per-provider integration config (one row per provider: "linear", "github", …). Holds the
// (optionally set) webhook signing secret, encrypted with INTERNAL_API_SECRET like user tokens.
export const integrationSettings = pgTable("integration_settings", {
  provider: text("provider").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  secretCiphertext: text("secret_ciphertext"),
  config: jsonb("config"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Latest-known snapshot of each Linear issue we've received via webhook (upserted by issue id).
// Only assigned issues are stored. Phase 2 matches assignee_email → app_users/directory email
// and surfaces recently-completed issues in a member's "Previously" check-in block.
export const linearActivity = pgTable("linear_activity", {
  linearIssueId: text("linear_issue_id").primaryKey(),
  identifier: text("identifier"),
  title: text("title"),
  url: text("url"),
  stateType: text("state_type"),
  assigneeEmail: text("assignee_email"),
  assigneeName: text("assignee_name"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  issueUpdatedAt: timestamp("issue_updated_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
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
export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];
export type TeamManager = typeof teamManagers.$inferSelect;
export type NewTeamManager = typeof teamManagers.$inferInsert;
export type SlackDirectoryUser = typeof slackDirectoryUsers.$inferSelect;
export type NewSlackDirectoryUser = typeof slackDirectoryUsers.$inferInsert;
export type IntegrationSetting = typeof integrationSettings.$inferSelect;
export type NewIntegrationSetting = typeof integrationSettings.$inferInsert;
export type LinearActivity = typeof linearActivity.$inferSelect;
export type NewLinearActivity = typeof linearActivity.$inferInsert;
