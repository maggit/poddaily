import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Landing } from "@/components/landing";
import { getInstanceConfig } from "@/lib/instance";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { official, instanceName } = getInstanceConfig();
  return <Landing official={official} instanceName={instanceName} />;
}
