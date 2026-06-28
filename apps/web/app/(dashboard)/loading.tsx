function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Loading">
      {/* header */}
      <div className="space-y-2.5">
        <Bar className="h-3 w-20" />
        <Bar className="h-7 w-52" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-card">
            <Bar className="h-3 w-16" />
            <Bar className="mt-3 h-7 w-12" />
          </div>
        ))}
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="border-b border-border bg-surface-muted/70 px-4 py-3">
          <Bar className="h-3 w-24" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3.5 w-40" />
              <Bar className="h-3 w-24" />
            </div>
            <Bar className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
