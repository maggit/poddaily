import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTeam, listMembers, addMember, setMemberPermissions, removeMember } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { MemberTable } from "@/components/teams/member-table";
import { AddMemberForm } from "@/components/teams/add-member-form";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const members = await listMembers(id);

  async function addMemberAction(fd: FormData) {
    "use server";
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    const slackDisplayName = String(fd.get("slackDisplayName") ?? "").trim();
    const timezone = String(fd.get("timezone") ?? "UTC");
    if (!slackUserId || !slackDisplayName) throw new Error("User id and display name are required");
    await addMember(id, { slackUserId, slackDisplayName, timezone, canReport: true, canView: true, canEdit: false });
    revalidatePath(`/teams/${id}`);
  }
  async function setPermAction(fd: FormData) {
    "use server";
    await setMemberPermissions(String(fd.get("memberId")), {
      canView: fd.get("canView") === "true",
      canReport: fd.get("canReport") === "true",
      canEdit: fd.get("canEdit") === "true",
    });
    revalidatePath(`/teams/${id}`);
  }
  async function removeAction(fd: FormData) {
    "use server";
    await removeMember(String(fd.get("memberId")));
    revalidatePath(`/teams/${id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={team.name} />
      <div className="text-sm text-muted-foreground">#{team.slackChannelName}{team.tribe ? ` · ${team.tribe}` : ""}</div>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Members</h2>
        <MemberTable members={members} setPermAction={setPermAction} removeAction={removeAction} />
        <AddMemberForm action={addMemberAction} />
      </section>
    </div>
  );
}
