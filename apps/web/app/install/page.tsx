import type { Metadata } from "next";
import { InstallGuide } from "@/components/install-guide";
import { getInstanceConfig } from "@/lib/instance";

// Render at request time so PODDAILY_OFFICIAL_INSTANCE / PODDAILY_INSTANCE_NAME are
// read from the running container's env, not baked in at image build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installation guide",
  description:
    "Install poddaily on your own infrastructure from the published Docker image: grab the compose file, create the Slack app, fill in .env, and docker compose up — migrations run automatically.",
};

export default function InstallPage() {
  const { official, instanceName } = getInstanceConfig();
  return <InstallGuide official={official} instanceName={instanceName} />;
}
