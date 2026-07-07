import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Landing } from "@/components/landing";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return <Landing />;
}
