import { createHmac, timingSafeEqual } from "node:crypto";
import type { LinearActivityInput } from "@poddaily/db";

/**
 * Verify Linear's `Linear-Signature` header: hex HMAC-SHA256 of the raw request body using the
 * webhook signing secret. Timing-safe. Returns false on any mismatch or missing header.
 */
export function verifyLinearSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The subset of a Linear webhook payload we read (payloads are otherwise untyped JSON). */
interface LinearWebhookBody {
  action?: string; // create | update | remove
  type?: string; // "Issue", "Comment", …
  data?: {
    id?: string;
    identifier?: string;
    title?: string;
    url?: string;
    completedAt?: string | null;
    updatedAt?: string | null;
    state?: { type?: string } | null;
    assignee?: { name?: string; email?: string } | null;
  };
}

/** Result of classifying a Linear webhook payload: store the snapshot, or skip with a reason. */
export type LinearParseResult =
  | { kind: "store"; activity: LinearActivityInput }
  | { kind: "skip"; reason: string };

/**
 * Classify a Linear webhook payload. We only process **assigned Issue** create/update events
 * (per the Linear integration spec); non-Issue types, removes, and unassigned issues are skipped
 * with a human-readable reason (logged by the webhook for observability).
 */
export function parseLinearIssueEvent(body: LinearWebhookBody): LinearParseResult {
  if (body.type !== "Issue") return { kind: "skip", reason: `non-issue event (type=${body.type ?? "?"})` };
  if (body.action === "remove") return { kind: "skip", reason: "issue removed" };
  const d = body.data;
  if (!d?.id) return { kind: "skip", reason: "missing issue id" };
  const email = d.assignee?.email?.trim().toLowerCase();
  if (!email) return { kind: "skip", reason: `unassigned or no assignee email (${d.identifier ?? d.id})` };

  return {
    kind: "store",
    activity: {
      linearIssueId: d.id,
      identifier: d.identifier ?? null,
      title: d.title ?? null,
      url: d.url ?? null,
      stateType: d.state?.type ?? null,
      assigneeEmail: email, // normalized lowercase so it matches directory/app_users emails
      assigneeName: d.assignee?.name ?? null,
      completedAt: d.completedAt ? new Date(d.completedAt) : null,
      issueUpdatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
    },
  };
}
