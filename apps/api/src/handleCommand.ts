import type { RetriggerJob } from "@poddaily/shared";
import type { createDb } from "@poddaily/db";
import { getMemberDayState, type MemberDayState } from "./standupState";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleCommandDeps {
  db: Db;
  enqueueRetrigger: (job: RetriggerJob) => Promise<void>;
}

export interface SlashCommand {
  slackUserId: string;
  text: string;
  channel: string; // command.channel_id — carried into the retrigger job
}

const NOT_SET_UP = "You're not set up for standups yet — ask an admin to add you to a team.";
const ALREADY_REPORTED = "You've already reported today ✅ — run `/standup status` to review.";
const IN_PROGRESS_START = "You've got a standup in progress — check your DMs to finish. ⏳";
const STARTING = "📋 Starting your standup — check your DMs.";

const HELP = [
  "*poddaily standup commands*",
  "• `/standup` or `/standup start` — start your standup now",
  "• `/standup status` — check whether you've reported today",
  "• `/standup help` — show this message",
].join("\n");

export function parseSubcommand(text: string): "start" | "status" | "help" {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "start") return "start";
  if (t === "status") return "status";
  return "help";
}

export function formatHelp(): string {
  return HELP;
}

export function formatStatus(state: MemberDayState): string {
  switch (state.kind) {
    case "not_member":
    case "no_standup":
      return NOT_SET_UP;
    case "completed":
      return "✅ You reported today.";
    case "in_progress":
      return `⏳ In progress — ${state.answered} of ${state.total} answered. Check your DMs to finish.`;
    case "pending":
      return "You haven't reported today yet — run `/standup` to start.";
  }
}

export async function handleCommand(deps: HandleCommandDeps, cmd: SlashCommand): Promise<string> {
  const sub = parseSubcommand(cmd.text);
  if (sub === "help") return formatHelp();

  const state = await getMemberDayState(deps.db, cmd.slackUserId);
  if (sub === "status") return formatStatus(state);

  // sub === "start"
  switch (state.kind) {
    case "not_member":
    case "no_standup":
      return NOT_SET_UP;
    case "completed":
      return ALREADY_REPORTED;
    case "in_progress":
      return IN_PROGRESS_START;
    case "pending":
      await deps.enqueueRetrigger({
        standupId: state.standup!.id,
        slackUserId: cmd.slackUserId,
        slackDisplayName: state.member!.slackDisplayName,
        channel: cmd.channel,
      });
      return STARTING;
  }
}
