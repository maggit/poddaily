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

export interface SlackClient {
  /** Open (or fetch) the DM channel with a user; returns the channel id. */
  openDm(slackUserId: string): Promise<string>;
  /** Post a message to a channel; returns the message ts. */
  postMessage(channel: string, text: string, opts?: PostMessageOptions): Promise<string>;
  /** Edit an existing message (chat.update). */
  updateMessage(channel: string, ts: string, opts: { text: string; blocks?: unknown[] }): Promise<void>;
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
  };
}
