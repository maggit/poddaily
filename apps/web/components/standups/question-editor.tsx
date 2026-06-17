"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
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

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} readOnly />
      {items.map((q, i) => (
        <div key={q.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
          <input
            value={q.text}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Question text"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="button" aria-label="move up" onClick={() => move(i, -1)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label="move down" onClick={() => move(i, 1)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" aria-label="remove" onClick={() => remove(i)} className="rounded p-1.5 text-danger hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
        <Plus className="h-4 w-4" /> Add question
      </button>
    </div>
  );
}
