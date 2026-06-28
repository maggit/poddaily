import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTeam } from "@/lib/teams";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import type { ActionState } from "@/components/ui/form";
import { CreateTeamForm } from "@/components/teams/create-team-form";

async function createTeamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slackChannelName = String(formData.get("slackChannelName") ?? "").trim();
  const slackChannelId = String(formData.get("slackChannelId") ?? "").trim();
  const tribe = String(formData.get("tribe") ?? "").trim() || undefined;
  if (!name || !slackChannelName || !slackChannelId) {
    return { error: "Name, channel name, and channel id are required." };
  }
  let team;
  try {
    team = await createTeam({ name, slackChannelName, slackChannelId, tribe });
  } catch (err) {
    return { error: (err as Error).message || "Could not create the team." };
  }
  revalidatePath("/dashboard");
  redirect(`/teams/${team.id}`);
}

export default function NewTeamPage() {
  return (
    <div className="reveal space-y-7">
      <PageHeader
        eyebrow="Workspace"
        title="Create team"
        description="Connect a Slack channel and we'll start collecting daily standups from its members."
      />
      <CreateTeamForm action={createTeamAction} />
    </div>
  );
}
