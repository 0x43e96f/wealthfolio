// Pieces shared by the 消费 tab's lists: a badge for how much a part grew or shrank
// against the period before, and the list of parts of a total with their shares.

// ▲ in the warning colour when more was spent, ▼ in the calm one when less. The amounts
// behind the percentage show at once on pointing at it (or focusing it).
export function ChangePill({
  usd,
  was,
  money,
}: {
  usd: number;
  was: number;
  money: (usd: number) => string;
}) {
  const diff = usd - was;
  const tip = `上期 ${money(was)}，${diff >= 0 ? "多" : "少"} ${money(Math.abs(diff))}`;
  const pct = was > 0 ? Math.round((Math.abs(diff) / was) * 100) : null;
  const flat = Math.abs(diff) < 0.5 || pct === 0;
  const text = flat
    ? "持平"
    : was <= 0
      ? "新增"
      : usd <= 0
        ? "没有了"
        : `${diff > 0 ? "▲" : "▼"} ${pct! > 999 ? ">999" : pct}%`;
  const tone = flat
    ? "bg-muted text-muted-foreground"
    : diff > 0
      ? "bg-destructive/15 text-destructive"
      : "bg-success/15 text-success";
  return (
    <span
      tabIndex={0}
      aria-label={`${text}，${tip}`}
      className="focus-visible:ring-ring group relative inline-flex rounded focus-visible:outline-none focus-visible:ring-2"
    >
      <span
        className={`inline-block min-w-14 rounded px-1.5 py-0.5 text-center text-xs font-medium tabular-nums ${tone}`}
      >
        {text}
      </span>
      <span
        role="tooltip"
        className="bg-popover text-popover-foreground invisible absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md group-hover:visible group-focus:visible"
      >
        {tip}
      </span>
    </span>
  );
}

export interface SplitItem {
  key: string;
  name: string;
  usd: number;
  count: number;
  was: number;
  note?: string; // a second line under the name (a trip's days, where most of it went)
}

// One line per part of the total, with a bar for its share; a line opens when onOpen is set.
export function SplitList({
  items,
  compare,
  money,
  sum,
  onOpen,
}: {
  items: SplitItem[];
  compare: boolean;
  money: (usd: number) => string;
  sum: number;
  onOpen?: (item: SplitItem) => void;
}) {
  if (items.length === 0)
    return <p className="text-muted-foreground py-3 text-sm">这个范围里没有消费。</p>;
  const share = (usd: number) => (sum > 0 ? `${Math.round((usd / sum) * 100)}%` : "");
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-center gap-2">
            {onOpen ? (
              <button
                type="button"
                className="focus-visible:ring-ring min-w-0 truncate text-left underline focus-visible:outline-none focus-visible:ring-2"
                onClick={() => onOpen(item)}
              >
                {item.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{item.name}</span>
            )}
            <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
              {item.count} 笔{"　"}
              {share(item.usd)}
            </span>
            {compare && <ChangePill usd={item.usd} was={item.was} money={money} />}
            <span className="w-24 shrink-0 text-right tabular-nums">{money(item.usd)}</span>
          </div>
          <div
            className="bg-primary/30 mt-0.5 h-1 rounded"
            style={{ width: `${sum > 0 ? Math.max(1, (item.usd / sum) * 100) : 0}%` }}
          />
          {item.note && (
            <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">{item.note}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
