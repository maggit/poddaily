import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getTeam, listMembers, addMember, setMemberPermissions, removeMember, setMemberAvatar } from "@/lib/teams";
import { listConnectedUserIds } from "@poddaily/db";
import { db } from "@/lib/db";
import { createSlackClient } from "@poddaily/slack-client";
import { enqueueLateJoinIfOpen } from "@/lib/late-join";
import { requireTeamEdit, requireAdmin, getCurrentUser, canEditTeam } from "@/lib/authz";
import { listTeamManagers, listManagerCandidates, addTeamManager, removeTeamManager } from "@/lib/users";
import { PageHeader } from "@/components/page-header";
import { MemberTable } from "@/components/teams/member-table";
import { AddMemberForm } from "@/components/teams/add-member-form";
import { ManagersSection } from "@/components/teams/managers-section";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const members = await listMembers(id);
  const connectedUserIds = await listConnectedUserIds(db, members.map((m) => m.slackUserId));

  async function addMemberAction(fd: FormData) {
    "use server";
    await requireTeamEdit(id);
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    const slackDisplayName = String(fd.get("slackDisplayName") ?? "").trim();
    const timezone = String(fd.get("timezone") ?? "UTC");
    if (!slackUserId || !slackDisplayName) throw new Error("User id and display name are required");
    const member = await addMember(id, { slackUserId, slackDisplayName, timezone, canReport: true, canView: true, canEdit: false });
    try {
      const profile = await createSlackClient().getUserProfile(slackUserId);
      if (profile.image) await setMemberAvatar(member.id, profile.image);
    } catch (err) {
      console.warn(`[avatar] fetch failed for ${slackUserId}:`, (err as Error).message);
    }
    try {
      await enqueueLateJoinIfOpen(member.id);
    } catch (err) {
      console.warn(`[late-join] enqueue failed for ${member.id}:`, (err as Error).message);
    }
    revalidatePath(`/teams/${id}`);
  }
  async function setPermAction(fd: FormData) {
    "use server";
    await requireTeamEdit(id);
    const memberId = String(fd.get("memberId"));
    await setMemberPermissions(memberId, {
      canView: fd.get("canView") === "true",
      canReport: fd.get("canReport") === "true",
      canEdit: fd.get("canEdit") === "true",
    });
    try {
      await enqueueLateJoinIfOpen(memberId);
    } catch (err) {
      console.warn(`[late-join] enqueue failed for ${memberId}:`, (err as Error).message);
    }
    revalidatePath(`/teams/${id}`);
  }
  async function removeAction(fd: FormData) {
    "use server";
    await requireTeamEdit(id);
    await removeMember(String(fd.get("memberId")));
    revalidatePath(`/teams/${id}`);
  }
  async function assignManagerAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    if (slackUserId) await addTeamManager(id, slackUserId);
    revalidatePath(`/teams/${id}`);
  }
  async function unassignManagerAction(fd: FormData) {
    "use server";
    await requireAdmin();
    await removeTeamManager(id, String(fd.get("slackUserId") ?? ""));
    revalidatePath(`/teams/${id}`);
  }

  const me = await getCurrentUser();
  const editable = await canEditTeam(me, id);
  const managers = me?.role === "admin" ? await listTeamManagers(id) : [];
  const managerCandidates = me?.role === "admin" ? await listManagerCandidates() : [];

  return (
    <div className="space-y-6">
      <PageHeader title={team.name} />
      <div className="text-sm text-muted-foreground">#{team.slackChannelName}{team.tribe ? ` · ${team.tribe}` : ""}</div>
      <div className="flex gap-4">
        <Link href={`/teams/${id}/standup`} className="text-[13px] font-medium text-accent hover:underline">Configure standup →</Link>
        <Link href={`/reports/${id}`} className="text-[13px] font-medium text-accent hover:underline">View reports →</Link>
      </div>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Members</h2>
        <MemberTable members={members} connectedUserIds={connectedUserIds} editable={editable} setPermAction={setPermAction} removeAction={removeAction} />
        {editable ? <AddMemberForm action={addMemberAction} /> : null}
      </section>
      {me?.role === "admin" ? (
        <ManagersSection
          managers={managers}
          candidates={managerCandidates}
          addAction={assignManagerAction}
          removeAction={unassignManagerAction}
        />
      ) : null}
    </div>
  );
}
