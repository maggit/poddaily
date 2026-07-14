import type { Metadata } from "next";
import { InstallGuide } from "@/components/install-guide";

export const metadata: Metadata = {
  title: "Installation guide",
  description:
    "Install poddaily on your own infrastructure from the published Docker image: grab the compose file, create the Slack app, fill in .env, and docker compose up — migrations run automatically.",
};

export default function InstallPage() {
  return <InstallGuide />;
}
