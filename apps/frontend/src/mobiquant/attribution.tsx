import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import { readAsset } from "./client";
import { AttributionPanel, type Attribution } from "./attribution-panel";

/** Hover, keyboard focus and touch all expose the same breakdown. */
export function DailyAttribution({
  asOf,
  hidden,
  date,
  total,
  close,
  children,
}: {
  asOf: string;
  hidden: boolean;
  date: string | null;
  total: string | null;
  close: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ asOf: string; data: Attribution | null; error: boolean }>({
    asOf,
    data: null,
    error: false,
  });
  const data = result.asOf === asOf ? result.data : null;
  const error = result.asOf === asOf && result.error;
  const pinned = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (error && !open) setAttempt((value) => value + 1);
    setRequested(true);
    setOpen(true);
  };
  const pin = () => {
    pinned.current = true;
    enter();
  };
  const changeOpen = (value: boolean) => {
    if (!value) pinned.current = false;
    setOpen(value);
  };
  const leave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (
        !pinned.current &&
        !triggerRef.current?.contains(focused) &&
        !contentRef.current?.contains(focused)
      )
        setOpen(false);
    }, 200);
  };
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );
  useEffect(() => {
    setResult({ asOf, data: null, error: false });
    if (!requested || !asOf) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    readAsset<Attribution>("attribution", controller.signal)
      .then((found) => {
        if (!Array.isArray(found.assets) || !Array.isArray(found.accounts))
          throw new Error("Invalid attribution");
        if (active && !controller.signal.aborted) setResult({ asOf, data: found, error: false });
      })
      .catch(() => {
        if (active) setResult({ asOf, data: null, error: true });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [asOf, requested, attempt]);
  // Beside the card the panel has the height of the window; under it, only what is left below.
  const beside = open && (triggerRef.current?.getBoundingClientRect().left ?? 0) >= 540;
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        asChild
        onClick={(event) => {
          event.preventDefault();
          pin();
        }}
      >
        <div
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label="查看今日净值变化明细"
          className="cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2"
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={enter}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pin();
            }
          }}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side={beside ? "left" : "bottom"}
        align={beside ? "start" : "end"}
        sideOffset={12}
        collisionPadding={16}
        className="flex max-h-[min(44rem,var(--radix-popover-content-available-height))] w-[min(31rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl p-0 shadow-2xl"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {error ? (
          <div role="status" className="p-4 text-sm">
            今日明细未读取成功，移开后重新打开即可重试。
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试
            </button>
          </div>
        ) : !data ? (
          <p role="status" className="text-muted-foreground p-4 text-sm">
            正在核对今日资产变化…
          </p>
        ) : (
          <AttributionPanel data={data} hidden={hidden} date={date} total={total} close={close} />
        )}
      </PopoverContent>
    </Popover>
  );
}
