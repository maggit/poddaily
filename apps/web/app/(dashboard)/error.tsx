"use client";
import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger-subtle text-danger">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h1 className="mt-4 font-heading text-[20px] font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[11px] text-subtle-foreground">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset} className="mt-5">
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
