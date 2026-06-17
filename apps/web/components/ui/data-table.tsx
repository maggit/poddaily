export function DataTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-subtle-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 text-left font-medium ${className}`}>{children}</th>;
}
export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-t border-border px-4 py-3 align-middle ${className}`}>{children}</td>;
}
