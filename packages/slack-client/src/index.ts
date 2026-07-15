import { WebClient } from "@slack/web-api";

export interface PostMessageOptions {
  /** thread_ts — post as a threaded reply. */
  threadTs?: string;
  /** chat:write.customize display name. */
  username?: string;
  /** chat:write.customize avatar. */
  iconUrl?: string;
  /** Block Kit blocks (text remains the notification fallback). */
  blocks?: unknown[];
}

/** A normalized Slack workspace member (from users.list). */
export interface SlackMember {
  id: string;
  displayName: string | null;
  realName: string | null;
  email: string | null;
  avatarUrl: string | null;
  tz: string | null;
  isBot: boolean;
  deleted: boolean;
}

export interface SlackClient {
  /** Open (or fetch) the DM channel with a user; returns the channel id. */
  openDm(slackUserId: string): Promise<string>;
  /** Post a message to a channel; returns the message ts. */
  postMessage(channel: string, text: string, opts?: PostMessageOptions): Promise<string>;
  /** Edit an existing message (chat.update). */
  updateMessage(channel: string, ts: string, opts: { text: string; blocks?: unknown[] }): Promise<void>;
  /** Resolve a message's shareable URL (chat.getPermalink); null on failure. */
  getPermalink(channel: string, ts: string): Promise<string | null>;
  /** Fetch a user's Slack profile (users.info). Needs the bot `users:read` scope. */
  getUserProfile(slackUserId: string): Promise<{ image: string | null; tz: string | null; realName: string | null }>;
  /**
   * List the ENTIRE workspace directory via users.list, draining cursor pagination
   * to completion (the common bug is reading only the first page). Needs the bot
   * `users:read` scope (+ `users:read.email` for emails). The WebClient handles 429
   * rate limits (honors Retry-After) via its retryConfig.
   */
  listAllUsers(): Promise<SlackMember[]>;
}

/** Shape of the bits of a Slack `users.list` member we consume. */
interface RawSlackMember {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  tz?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    image_192?: string;
    image_512?: string;
  };
}

function mapMember(m: RawSlackMember): SlackMember {
  return {
    id: m.id ?? "",
    displayName: m.profile?.display_name || m.profile?.real_name || m.real_name || null,
    realName: m.profile?.real_name || m.real_name || null,
    email: m.profile?.email ?? null,
    avatarUrl: m.profile?.image_512 ?? m.profile?.image_192 ?? null,
    tz: m.tz ?? null,
    isBot: Boolean(m.is_bot),
    deleted: Boolean(m.deleted),
  };
}

export interface SlackClientOptions {
  token?: string;
  /** Override the Slack API root (e.g. the stub). `/api/` is appended. */
  baseUrl?: string;
}

export function createSlackClient(opts: SlackClientOptions = {}): SlackClient {
  const token = opts.token ?? process.env.SLACK_BOT_TOKEN;
  const baseUrl = opts.baseUrl ?? process.env.SLACK_API_BASE_URL;
  const slackApiUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "").replace(/\/api$/, "")}/api/`
    : undefined; // WebClient defaults to https://slack.com/api/
  const web = new WebClient(token, {
    ...(slackApiUrl ? { slackApiUrl } : {}),
    retryConfig: { retries: 3 },
  });

  return {
    async openDm(slackUserId) {
      const res = await web.conversations.open({ users: slackUserId });
      if (!res.channel?.id) throw new Error("conversations.open returned no channel id");
      return res.channel.id;
    },
    async postMessage(channel, text, opts = {}) {
      const res = await web.chat.postMessage({
        channel,
        text,
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
        ...(opts.username ? { username: opts.username } : {}),
        ...(opts.iconUrl ? { icon_url: opts.iconUrl } : {}),
        ...(opts.blocks ? { blocks: opts.blocks as never } : {}),
      });
      if (!res.ts) throw new Error("chat.postMessage returned no ts");
      return res.ts;
    },
    async updateMessage(channel, ts, opts) {
      await web.chat.update({
        channel,
        ts,
        text: opts.text,
        ...(opts.blocks ? { blocks: opts.blocks as never } : {}),
      });
    },
    async getPermalink(channel, ts) {
      try {
        const res = await web.chat.getPermalink({ channel, message_ts: ts });
        return res.permalink ?? null;
      } catch {
        // Best-effort: a missing permalink must never fail the caller's flow.
        return null;
      }
    },
    async getUserProfile(slackUserId) {
      const res = await web.users.info({ user: slackUserId });
      const u = res.user as
        | { real_name?: string; tz?: string; profile?: { image_192?: string; image_512?: string } }
        | undefined;
      return {
        image: u?.profile?.image_512 ?? u?.profile?.image_192 ?? null,
        tz: u?.tz ?? null,
        realName: u?.real_name ?? null,
      };
    },
    async listAllUsers() {
      const members: SlackMember[] = [];
      let cursor: string | undefined;
      // Safety cap: ~200 pages * 200 = 40k users; far above any real workspace, but
      // guarantees we never loop forever on a misbehaving cursor.
      for (let page = 0; page < 200; page++) {
        const res = await web.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
        for (const m of (res.members ?? []) as RawSlackMember[]) {
          if (m.id) members.push(mapMember(m));
        }
        cursor = res.response_metadata?.next_cursor || undefined;
        if (!cursor) break; // drained — no more pages
      }
      return members;
    },
  };
}
