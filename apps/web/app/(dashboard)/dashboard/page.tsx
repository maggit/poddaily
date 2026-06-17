import Link from "next/link";
import { listTeams, listMembers } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

export default async function TeamsPage() {
  const teams = await listTeams();
  const counts = await Promise.all(teams.map((t) => listMembers(t.id).then((m) => m.length)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        actions={
          <Link href="/teams/new" className={cn(buttonVariants({ size: "lg" }))}>
            Create team
          </Link>
        }
      />
      {teams.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No teams yet. Create your first team to get started.
        </div>
      ) : (
        <DataTable head={<><Th>Team</Th><Th>Tribe</Th><Th>Members</Th><Th /></>}>
          {teams.map((t, i) => (
            <tr key={t.id} className="hover:bg-surface-muted">
              <Td>
                <Link href={`/teams/${t.id}`} className="font-medium text-foreground hover:text-accent">{t.name}</Link>
                <span className="ml-2 text-subtle-foreground">#{t.slackChannelName}</span>
              </Td>
              <Td className="text-muted-foreground">{t.tribe ?? "—"}</Td>
              <Td className="text-muted-foreground">{counts[i]}</Td>
              <Td className="text-right"><Link href={`/teams/${t.id}`} className="text-accent">Manage</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
