import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  /** Render as dots only (e.g. error markers). */
  dots?: boolean;
  /** Plain dots of this radius, without the outline ring (for dense scatter). */
  dotRadius?: number;
  /** Kept in the legend (when toggleable) but not drawn. */
  hidden?: boolean;
  format?: (v: number) => string;
}

export interface RefLine {
  value: number;
  label: string;
}

interface LineChartProps {
  series: Series[];
  /** Tooltip heading per x index. */
  xLabels: string[];
  /** Short tick labels per x index (only some are shown). */
  xTicks?: (i: number) => string;
  height?: number;
  refLines?: RefLine[];
  yMin?: number;
  yMax?: number;
  ariaLabel: string;
  /** Makes legend entries buttons that show/hide a series (by name) or the target lines ('targets'). */
  onToggle?: (name: string) => void;
  /** Target lines are listed in the legend but not drawn. */
  refLinesHidden?: boolean;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  const end = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step) * step; v <= end + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const PAD = { l: 36, r: 12, t: 10, b: 24 };
const NO_REF_LINES: RefLine[] = [];

export function LineChart({
  series: allSeries,
  xLabels,
  xTicks,
  height = 220,
  refLines: allRefLines = [],
  yMin,
  yMax,
  ariaLabel,
  onToggle,
  refLinesHidden = false,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const series = useMemo(() => allSeries.filter((s) => !s.hidden), [allSeries]);
  const refLines = refLinesHidden ? NO_REF_LINES : allRefLines;
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;

  const { ticks, y, x } = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const refs = refLines.map((r) => r.value);
    const lo = yMin ?? Math.min(0, ...vals);
    const dataMax = Math.max(1, ...vals);
    // Only stretch the axis to a target line if it is reasonably close.
    const hi = yMax ?? Math.max(dataMax, ...refs.filter((r) => r <= dataMax * 1.35));
    const ticks = niceTicks(lo, hi);
    const top = ticks[ticks.length - 1];
    const bottom = ticks[0];
    const innerH = height - PAD.t - PAD.b;
    const innerW = Math.max(10, width - PAD.l - PAD.r);
    return {
      ticks,
      y: (v: number) => PAD.t + innerH - ((v - bottom) / (top - bottom || 1)) * innerH,
      x: (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    };
  }, [series, refLines, yMin, yMax, height, width, n]);

  const top = ticks[ticks.length - 1];
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const innerW = width - PAD.l - PAD.r;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.l) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else return;
    e.preventDefault();
  };

  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 70))));

  if (n === 0) return <div className="empty">No data yet.</div>;

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const tipLeft = hover !== null ? Math.min(Math.max(0, x(hover) + 12), width - 170) : 0;

  return (
    <div className="chart" ref={ref}>
      {allSeries.length > 1 && (
        <div className="legend">
          {allSeries.map((s) => (
            <LegendItem key={s.name} label={s.name} on={!s.hidden} onToggle={onToggle && (() => onToggle(s.name))}>
              <i className={s.dots ? 'dot' : ''} style={{ background: s.color }} />
            </LegendItem>
          ))}
          {allRefLines.length > 0 && (
            <LegendItem label="targets" on={!refLinesHidden} onToggle={onToggle && (() => onToggle('targets'))}>
              <i style={{ background: 'var(--muted)', height: 1 }} />
            </LegendItem>
          )}
        </div>
      )}
      <svg
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {xTicks &&
            xLabels.map((_, i) =>
              i % tickEvery === 0 ? (
                <text key={i} x={x(i)} y={height - 6} textAnchor="middle">
                  {xTicks(i)}
                </text>
              ) : null,
            )}
        </g>
        {refLines
          .filter((r) => r.value <= top)
          .map((r) => (
            <g key={r.label}>
              <line className="ref-line" x1={PAD.l} x2={width - PAD.r} y1={y(r.value)} y2={y(r.value)} />
              <text className="ref-label" x={width - PAD.r} y={y(r.value) - 4} textAnchor="end">
                {r.label}
              </text>
            </g>
          ))}
        {series.map((s) =>
          s.dots ? (
            <g key={s.name}>
              {s.values.map((v, i) =>
                v === null ? null : s.dotRadius ? (
                  <circle key={i} cx={x(i)} cy={y(v)} r={s.dotRadius} fill={s.color} />
                ) : (
                  <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ),
              )}
            </g>
          ) : (
            <path
              key={s.name}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {series.map((s) => {
          if (s.dots) return null;
          const lastIdx = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
          const v = s.values[lastIdx];
          return lastIdx >= 0 && v !== null ? (
            <circle key={s.name + '-end'} cx={x(lastIdx)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
          ) : null;
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke="var(--muted)" strokeWidth={1} />
            {series.map((s) => {
              const v = s.values[hover];
              return v === null || v === undefined ? null : (
                <circle key={s.name} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              );
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: tipLeft, top: 24 }}>
          <div className="n">{xLabels[hover]}</div>
          {series.map((s) => {
            const v = s.values[hover];
            if (v === null || v === undefined) return null;
            return (
              <div className="row" key={s.name}>
                <span className="key-line" style={{ background: s.color }} />
                <span className="v">{s.format ? s.format(v) : v}</span>
                <span className="n">{s.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LegendItem({ label, on, onToggle, children }: { label: string; on: boolean; onToggle?: () => void; children: React.ReactNode }) {
  if (!onToggle) {
    return (
      <span>
        {children}
        {label}
      </span>
    );
  }
  return (
    <button type="button" className={on ? '' : 'off'} aria-pressed={on} onClick={onToggle} title={on ? `Hide ${label}` : `Show ${label}`}>
      {children}
      {label}
    </button>
  );
}

export interface CalendarDay {
  key: string;
  minutes: number;
  frozen?: boolean;
  inRange: boolean;
}

/** GitHub-style practice calendar, weeks as columns (Monday first). */
export function Calendar({ weeks, label }: { weeks: CalendarDay[][]; label: (d: CalendarDay) => string }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);
  const level = (m: number) => (m <= 0 ? 0 : m < 5 ? 1 : m < 15 ? 2 : m < 30 ? 3 : 4);
  return (
    <div style={{ position: 'relative' }}>
      <div className="calendar" ref={scrollRef} role="grid" aria-label="Practice calendar">
        {weeks.map((w, i) => (
          <div className="col" key={i} role="row">
            {w.map((d) => (
              <div
                key={d.key}
                role="gridcell"
                tabIndex={d.inRange ? 0 : -1}
                aria-label={d.inRange ? label(d) : undefined}
                className={`cell ${d.inRange ? '' : 'out'} ${d.frozen && d.minutes === 0 ? 'frozen' : ''}`}
                style={d.inRange && !(d.frozen && d.minutes === 0) ? { background: `var(--heat-${level(d.minutes)})` } : undefined}
                onPointerEnter={(e) => {
                  if (!d.inRange) return;
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const p = (e.currentTarget.closest('.calendar')!.parentElement as HTMLElement).getBoundingClientRect();
                  setTip({ text: label(d), x: r.left - p.left, y: r.top - p.top - 34 });
                }}
                onPointerLeave={() => setTip(null)}
              />
            ))}
          </div>
        ))}
      </div>
      {tip && (
        <div className="tooltip" style={{ left: Math.max(0, tip.x - 60), top: tip.y }}>
          {tip.text}
        </div>
      )}
      <div className="legend" style={{ marginTop: 8 }}>
        <span>less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l}>
            <i style={{ width: 12, height: 12, borderRadius: 3, background: `var(--heat-${l})` }} />
          </span>
        ))}
        <span>more</span>
        <span>
          <i style={{ width: 12, height: 12, borderRadius: 3, outline: '2px solid var(--series-1)', outlineOffset: -2 }} />
          freeze used
        </span>
      </div>
    </div>
  );
}
