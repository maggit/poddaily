/** A curated IANA timezone shortlist for the member TZ picker. */
export const COMMON_TIMEZONES = [
  "America/Mexico_City",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
] as const;

export type Timezone = (typeof COMMON_TIMEZONES)[number];

/**
 * Human labels for the picker. Cities that share an IANA zone are listed together
 * (Guadalajara has no zone of its own — it is America/Mexico_City).
 */
export const TIMEZONE_LABELS: Record<Timezone, string> = {
  "America/Mexico_City": "Mexico City / Guadalajara, Mexico",
  "America/Bogota": "Bogotá, Colombia",
  "America/Argentina/Buenos_Aires": "Buenos Aires, Argentina",
  "America/New_York": "New York, US (Eastern)",
  "America/Chicago": "Chicago, US (Central)",
  "America/Denver": "Denver, US (Mountain)",
  "America/Los_Angeles": "Los Angeles, US (Pacific)",
  "America/Sao_Paulo": "São Paulo, Brazil",
  "Europe/London": "London, UK",
  "Europe/Madrid": "Madrid, Spain",
  "Europe/Berlin": "Berlin, Germany",
  "Asia/Kolkata": "Kolkata, India",
  "Asia/Singapore": "Singapore",
  "Australia/Sydney": "Sydney, Australia",
  UTC: "UTC",
};

/** `{ value, label }` pairs for `<select>` options, in COMMON_TIMEZONES order. */
export const TIMEZONE_OPTIONS = COMMON_TIMEZONES.map((tz) => ({
  value: tz,
  label: `${TIMEZONE_LABELS[tz]} — ${tz}`,
}));
