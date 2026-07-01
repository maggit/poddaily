import { NextResponse, type NextRequest } from "next/server";
import { decryptToken } from "@poddaily/shared";
import { getIntegrationSetting, upsertLinearActivity, recordIntegrationEvent } from "@poddaily/db";
import { db } from "@/lib/db";
import { verifyLinearSignature, parseLinearIssueEvent } from "@/lib/linear";

export const runtime = "nodejs";

/**
 * POST /api/integrations/linear/webhook — receives Linear "Issue" data-change events.
 * Public (no session): Linear posts here directly, so it's excluded from auth middleware.
 * If a signing secret has been configured on the Integrations page, the Linear-Signature
 * header is verified; otherwise events are accepted unverified.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const setting = await getIntegrationSetting(db, "linear");
  if (setting?.secretCiphertext) {
    let secret = "";
    try {
      secret = decryptToken(setting.secretCiphertext, process.env.INTERNAL_API_SECRET ?? "");
    } catch {
      console.error("[linear-webhook] could not decrypt signing secret");
      return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
    }
    if (!verifyLinearSignature(raw, req.headers.get("linear-signature"), secret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  // A legit (signature-passing) event arrived — record it for the "events are arriving" indicator,
  // even when the integration is disabled or the event is ultimately skipped.
  await recordIntegrationEvent(db, "linear");

  // Disconnected: a config row exists and is explicitly disabled → accept but ignore.
  // (No row = default-on, so a fresh "paste the URL" setup works before any config is saved.)
  if (setting && setting.enabled === false) {
    return NextResponse.json({ ok: true, stored: false, disabled: true });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = parseLinearIssueEvent(body as Parameters<typeof parseLinearIssueEvent>[0]);
  if (result.kind === "skip") {
    console.log(`[linear-webhook] skipped — ${result.reason}`);
    return NextResponse.json({ ok: true, stored: false, skipped: result.reason });
  }

  try {
    await upsertLinearActivity(db, result.activity);
  } catch (err) {
    console.error("[linear-webhook] failed to store issue:", (err as Error).message);
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }
  console.log(`[linear-webhook] stored ${result.activity.identifier ?? result.activity.linearIssueId} (${result.activity.stateType ?? "?"}) for ${result.activity.assigneeEmail}`);
  return NextResponse.json({ ok: true, stored: true });
}
