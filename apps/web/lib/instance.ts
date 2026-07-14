// Instance identity for the public landing pages, read from the environment at
// request time (both pages render dynamically, so a prebuilt image honors runtime env).
//
// PODDAILY_OFFICIAL_INSTANCE — maintainer-only flag for the canonical deployment
//   (poddaily.io): shows the maintainer credit and hides the self-hosted instance
//   banner + sign-in links. Defaults to false; self-hosters never set it.
// PODDAILY_INSTANCE_NAME — optional display name for a self-hosted deployment
//   (e.g. "Clara"): personalizes the instance banner and sign-in links.

export type InstanceConfig = {
  official: boolean;
  instanceName: string | null;
};

export function getInstanceConfig(): InstanceConfig {
  const flag = (process.env.PODDAILY_OFFICIAL_INSTANCE ?? "").trim().toLowerCase();
  return {
    official: flag === "true" || flag === "1",
    instanceName: process.env.PODDAILY_INSTANCE_NAME?.trim() || null,
  };
}
