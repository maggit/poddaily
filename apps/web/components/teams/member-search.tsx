"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { fieldClass } from "@/components/ui/form";

export interface DirUser {
  id: string;
  displayName: string;
  handle: string;
  email: string | null;
  avatarUrl: string | null;
  tz: string | null;
}

export function MemberSearch({
  selected,
  onSelect,
}: {
  selected: DirUser | null;
  onSelect: (u: DirUser | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<DirUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced, abortable search. Stale responses are cancelled so the dropdown never
  // flickers older results over newer keystrokes.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const res = await fetch(`/api/directory/search?q=${encodeURIComponent(query)}`, { signal: ac.signal });
        const data = (await res.json()) as { users?: DirUser[]; nextOffset?: number | null };
        setResults(data.users ?? []);
        setHasMore(data.nextOffset != null);
        setActive(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Close when clicking outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(u: DirUser) {
    onSelect(u);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Selected state: a compact chip with a clear button. The parent owns the value.
  if (selected) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-xs">
        <Avatar src={selected.avatarUrl} name={selected.displayName} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{selected.displayName}</p>
          <p className="truncate font-mono text-[11px] text-subtle-foreground">{selected.handle}</p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label="Clear selection"
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const showDropdown = open && (loading || results.length > 0 || query.length > 0);

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle-foreground" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="member-search-listbox"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Search teammates by name…"
        className={`${fieldClass} pl-8`}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {loading ? (
        <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-subtle-foreground" />
      ) : null}

      {showDropdown ? (
        <ul
          id="member-search-listbox"
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          {results.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(u);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  i === active ? "bg-accent-subtle" : "hover:bg-surface-muted"
                }`}
              >
                <Avatar src={u.avatarUrl} name={u.displayName} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{u.displayName}</p>
                  <p className="truncate text-[11.5px] text-subtle-foreground">
                    {u.email ?? u.handle}
                  </p>
                </div>
              </button>
            </li>
          ))}
          {!loading && results.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] text-subtle-foreground">
              {query ? "No matching teammates." : "Start typing to search."}
            </li>
          ) : null}
          {hasMore ? (
            <li className="border-t border-border px-3 py-2 text-center text-[11.5px] text-subtle-foreground">
              More matches — keep typing to narrow.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
