import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTeam } from "@/lib/teams";
import { getStandup, upsertStandup, setStandupActive } from "@/lib/standups";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { StandupForm } from "@/components/standups/standup-form";
import { DEFAULT_QUESTIONS, cronFromWeekly, parseWeeklyCron, type Question } from "@poddaily/shared";

export default async function StandupConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const standup = await getStandup(id);

  const questions = (standup?.questions as Question[] | undefined) ?? DEFAULT_QUESTIONS;
  const { weekdays, hour, minute } = standup
    ? parseWeeklyCron(standup.scheduleCron)
    : { weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 };
  const tz = standup?.scheduleTz ?? "America/Mexico_City";
  const introMessage = standup?.introMessage ?? "Hi! Time for Daily Standup.";
  const outroMessage = standup?.outroMessage ?? "Thanks for your update!";

  async function saveAction(fd: FormData) {
    "use server";
    const parsedQuestions = JSON.parse(String(fd.get("questions") ?? "[]")) as Question[];
    const cleaned = parsedQuestions.map((q) => ({ ...q, text: q.text.trim() })).filter((q) => q.text.length > 0);
    const weekdayNums = String(fd.get("weekdays") ?? "").split(",").filter(Boolean).map(Number);
    const [h, m] = String(fd.get("time") ?? "10:00").split(":").map(Number);
    if (cleaned.length === 0) throw new Error("At least one question is required");
    if (weekdayNums.length === 0) throw new Error("Pick at least one weekday");
    if (Number.isNaN(h) || Number.isNaN(m)) throw new Error("A valid time is required");
    await upsertStandup(id, {
      questions: cleaned,
      scheduleCron: cronFromWeekly({ weekdays: weekdayNums, hour: h, minute: m }),
      scheduleTz: String(fd.get("scheduleTz") ?? "America/Mexico_City"),
      introMessage: String(fd.get("introMessage") ?? ""),
      outroMessage: String(fd.get("outroMessage") ?? ""),
    });
    revalidatePath(`/teams/${id}/standup`);
    redirect(`/teams/${id}`);
  }

  async function toggleActiveAction() {
    "use server";
    const current = await getStandup(id);
    if (!current) return;
    await setStandupActive(id, !current.isActive);
    revalidatePath(`/teams/${id}/standup`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`${team.name} · Standup`} />
      {standup ? (
        <div className="flex items-center gap-3">
          <StatusPill tone={standup.isActive === false ? "neutral" : "success"}>
            {standup.isActive === false ? "Paused" : "Active"}
          </StatusPill>
          <form action={toggleActiveAction}>
            <button type="submit" className="text-[13px] font-medium text-accent hover:underline">
              {standup.isActive === false ? "Resume standup" : "Pause standup"}
            </button>
          </form>
        </div>
      ) : null}
      <StandupForm
        action={saveAction}
        questions={questions}
        weekdays={weekdays} hour={hour} minute={minute} tz={tz}
        introMessage={introMessage} outroMessage={outroMessage}
      />
    </div>
  );
}
