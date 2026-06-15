const TOKEN = "{last_report_date}";

/** Format as "Friday, Jun 12" in UTC (deterministic for tests + scheduling). */
export function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function interpolateLastReportDate(
  text: string,
  lastReportDate: Date | null,
): string {
  if (!text.includes(TOKEN)) return text;
  const replacement = lastReportDate
    ? formatReportDate(lastReportDate)
    : "your last report";
  return text.split(TOKEN).join(replacement);
}
