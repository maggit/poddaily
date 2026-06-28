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
import { Settings2, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle, type ActionState } from "@/components/ui/form";
import { buttonVariants } from "@/components/ui/button";
import { MemberTable } from "@/components/teams/member-table";
import { AddMemberForm } from "@/components/teams/add-member-form";
import { ManagersSection } from "@/components/teams/managers-section";
import { cn } from "@/lib/utils";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const members = await listMembers(id);
  const connectedUserIds = await listConnectedUserIds(db, members.map((m) => m.slackUserId));

  async function addMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
    "use server";
    await requireTeamEdit(id);
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    const slackDisplayName = String(fd.get("slackDisplayName") ?? "").trim();
    const timezone = String(fd.get("timezone") ?? "UTC");
    if (!slackUserId || !slackDisplayName) return { error: "Display name and Slack user ID are required." };
    let member;
    try {
      member = await addMember(id, { slackUserId, slackDisplayName, timezone, canReport: true, canView: true, canEdit: false });
    } catch (err) {
      return { error: (err as Error).message || "Could not add this member." };
    }
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
    return { ok: true };
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
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow={`#${team.slackChannelName}${team.tribe ? ` · ${team.tribe}` : ""}`}
          title={team.name}
          actions={
            <>
              <Link href={`/teams/${id}/standup`} className={cn(buttonVariants({ variant: "outline" }))}>
                <Settings2 className="h-4 w-4" />
                Configure standup
              </Link>
              <Link href={`/reports/${id}`} className={cn(buttonVariants({ variant: "outline" }))}>
                <BarChart3 className="h-4 w-4" />
                View reports
              </Link>
            </>
          }
        />
      </div>
      <section className="reveal space-y-3" style={{ animationDelay: "80ms" }}>
        <SectionTitle>Members</SectionTitle>
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
