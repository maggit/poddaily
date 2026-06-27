import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTeam } from "@/lib/teams";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { CreateTeamForm } from "@/components/teams/create-team-form";

async function createTeamAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slackChannelName = String(formData.get("slackChannelName") ?? "").trim();
  const slackChannelId = String(formData.get("slackChannelId") ?? "").trim();
  const tribe = String(formData.get("tribe") ?? "").trim() || undefined;
  if (!name || !slackChannelName || !slackChannelId) {
    throw new Error("Name, channel name, and channel id are required");
  }
  const team = await createTeam({ name, slackChannelName, slackChannelId, tribe });
  revalidatePath("/dashboard");
  redirect(`/teams/${team.id}`);
}

export default function NewTeamPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Create team" />
      <CreateTeamForm action={createTeamAction} />
    </div>
  );
}
