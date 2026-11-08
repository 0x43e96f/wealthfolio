import { useState } from "react";
import { Checkbox } from "@wealthfolio/ui/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";

// A drop-down button holding a two-level list of check boxes: a parent (a category
// group, a tag kind) ticks or unticks all its children at once. The selection is the
// set of child keys; an empty set means everything.

export interface MenuLeaf {
  key: string;
  label: string;
  usd: number;
}
export interface MenuNode {
  key: string;
  label: string;
  usd: number;
  leaves: MenuLeaf[];
}

const SEARCH_FROM = 15; // more children than this and the menu gets a search box

export function CheckMenu({
  name,
  everything,
  nodes,
  selected,
  onChange,
  money,
}: {
  name: string; // 类别, 标签
  everything: string; // what an empty selection reads as: 全部类别
  nodes: MenuNode[];
  selected: string[];
  onChange: (next: string[]) => void;
  money: (value: string) => string;
}) {
  const [needle, setNeedle] = useState("");
  const chosen = new Set(selected);
  const leafCount = nodes.reduce((total, node) => total + node.leaves.length, 0);
  const text = needle.trim().toLowerCase();
  const visible = nodes
    .map((node) => ({
      ...node,
      leaves: text
        ? node.leaves.filter((leaf) => (node.label + leaf.label).toLowerCase().includes(text))
        : node.leaves,
    }))
    .filter((node) => node.leaves.length > 0);

  // The button names what is chosen: a whole parent by its own name.
  const names = nodes.flatMap((node) => {
    const mine = node.leaves.filter((leaf) => chosen.has(leaf.key));
    if (mine.length === 0) return [];
    if (mine.length === node.leaves.length) return [node.label];
    return mine.map((leaf) => leaf.label);
  });
  const summary =
    names.length === 0
      ? everything
      : names.length <= 2
        ? names.join("、")
        : `${names.slice(0, 2).join("、")} 等 ${names.length} 项`;

  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onChange([...next]);
  };
  const lone = (node: MenuNode) => node.leaves.length === 1 && node.leaves[0].label === node.label;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${name}筛选`}
          className={`border-input bg-background focus-visible:ring-ring inline-flex h-9 max-w-full items-center gap-2 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 ${
            selected.length ? "border-primary" : ""
          }`}
        >
          <span className="text-muted-foreground">{name}</span>
          <span className="truncate">{summary}</span>
          <span aria-hidden className="text-muted-foreground text-xs">
            ▾
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b p-2">
          {leafCount > SEARCH_FROM && (
            <input
              aria-label={`搜索${name}`}
              placeholder={`搜索${name}`}
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
            />
          )}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onChange([])}
            className="text-muted-foreground ml-auto shrink-0 text-xs underline disabled:no-underline disabled:opacity-50"
          >
            清空（看{everything}）
          </button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2 text-sm">
          {visible.map((node) => {
            const keys = node.leaves.map((leaf) => leaf.key);
            const ticked = keys.filter((key) => chosen.has(key)).length;
            const state = ticked === 0 ? false : ticked === keys.length ? true : "indeterminate";
            return (
              <li key={node.key} className="py-0.5">
                <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1 py-1">
                  <Checkbox
                    aria-label={node.label}
                    checked={state}
                    onCheckedChange={() => toggle(keys, state !== true)}
                  />
                  <span className={lone(node) ? "" : "font-medium"}>{node.label}</span>
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    {node.usd ? money(String(node.usd)) : ""}
                  </span>
                </label>
                {!lone(node) && (
                  <ul className="ml-6">
                    {node.leaves.map((leaf) => (
                      <li key={leaf.key}>
                        <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1 py-1">
                          <Checkbox
                            aria-label={`${node.label} ${leaf.label}`}
                            checked={chosen.has(leaf.key)}
                            onCheckedChange={(on: boolean | "indeterminate") =>
                              toggle([leaf.key], on === true)
                            }
                          />
                          <span>{leaf.label}</span>
                          <span className="text-muted-foreground ml-auto tabular-nums">
                            {leaf.usd ? money(String(leaf.usd)) : ""}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="text-muted-foreground px-1 py-3 text-center">没有匹配的{name}。</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
