import { WebClient } from "@slack/web-api";

export interface SlackClient {
  /** Open (or fetch) the DM channel with a user; returns the channel id. */
  openDm(slackUserId: string): Promise<string>;
  /** Post a plain-text message to a channel; returns the message ts. */
  postMessage(channel: string, text: string): Promise<string>;
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
    ? `${baseUrl.replace(/\/$/, "")}/api/`
    : undefined; // WebClient defaults to https://slack.com/api/
  const web = new WebClient(token, slackApiUrl ? { slackApiUrl } : {});

  return {
    async openDm(slackUserId) {
      const res = await web.conversations.open({ users: slackUserId });
      if (!res.ok || !res.channel?.id) {
        throw new Error(`conversations.open failed: ${res.error ?? "unknown"}`);
      }
      return res.channel.id;
    },
    async postMessage(channel, text) {
      const res = await web.chat.postMessage({ channel, text });
      if (!res.ok || !res.ts) {
        throw new Error(`chat.postMessage failed: ${res.error ?? "unknown"}`);
      }
      return res.ts;
    },
  };
}
