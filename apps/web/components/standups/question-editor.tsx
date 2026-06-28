"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/form";
import type { Question } from "@poddaily/shared";

export function QuestionEditor({ initial, name }: { initial: Question[]; name: string }) {
  const [items, setItems] = useState<Question[]>(initial);

  const update = (i: number, text: string) =>
    setItems((xs) => xs.map((q, j) => (j === i ? { ...q, text } : q)));
  const remove = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = () =>
    setItems((xs) => [...xs, { id: `q${Date.now()}-${xs.length}`, text: "", type: "text" }]);

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} readOnly />
      {items.map((q, i) => (
        <div key={q.id} className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold tabular-nums text-subtle-foreground ring-1 ring-inset ring-border">
            {i + 1}
          </span>
          <Input value={q.text} onChange={(e) => update(i, e.target.value)} placeholder="Question text" className="flex-1" />
          <div className="flex items-center">
            <button type="button" aria-label="move up" disabled={i === 0} onClick={() => move(i, -1)} className={iconBtn}><ArrowUp className="h-4 w-4" /></button>
            <button type="button" aria-label="move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} className={iconBtn}><ArrowDown className="h-4 w-4" /></button>
            <button type="button" aria-label="remove" onClick={() => remove(i)} className="flex h-8 w-8 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-danger-subtle hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:border-accent hover:bg-accent-subtle hover:text-accent"
      >
        <Plus className="h-4 w-4" /> Add question
      </button>
    </div>
  );
}
