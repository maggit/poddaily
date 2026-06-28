export function DataTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead className="border-b border-border bg-surface-muted/70 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle-foreground">
            <tr>{head}</tr>
          </thead>
          <tbody className="[&>tr]:transition-colors">{children}</tbody>
        </table>
      </div>
    </div>
  );
}
export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left font-medium ${className}`}>{children}</th>;
}
export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={`border-t border-border px-4 py-3.5 align-middle [tr:first-child>&]:border-t-0 ${className}`}>
      {children}
    </td>
  );
}
