import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-subtle text-accent">
        <Compass className="h-6 w-6" />
      </div>
      <h1 className="mt-4 font-heading text-[20px] font-semibold tracking-tight">Not found</h1>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        This page doesn&apos;t exist, or the team or report you&apos;re looking for may have been removed.
      </p>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "accent" }), "mt-5")}>
        Back to Teams
      </Link>
    </div>
  );
}
