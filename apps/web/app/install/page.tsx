import type { Metadata } from "next";
import { InstallGuide } from "@/components/install-guide";

export const metadata: Metadata = {
  title: "Installation guide",
  description:
    "Install poddaily on your own infrastructure: provision Postgres and Redis, create the Slack app, configure callback URLs and environment variables, deploy the services, and connect Linear.",
};

export default function InstallPage() {
  return <InstallGuide />;
}
