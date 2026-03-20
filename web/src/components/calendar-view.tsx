"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ScoreBadge } from "./score-badge";
import { RevenueBadge } from "./revenue-badge";

type CalendarEvent = {
  id: number;
  name: string;
  event_type: string | null;
  location: string | null;
  date_start: string | null;
  date_end: string | null;
  date_display: string | null;
  estimated_attendance: string | null;
  is_recurring: number;
  score: number;
  estimated_revenue_low: number | null;
  estimated_revenue_high: number | null;
};

type Props = {
  events: CalendarEvent[];
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function scoreDotColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  if (score >= 40) return "bg-orange-400";
  return "bg-gray-300 dark:bg-gray-600";
}

function buildEventMap(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  const undated: CalendarEvent[] = [];

  for (const ev of events) {
    if (!ev.date_start) {
      undated.push(ev);
      continue;
    }

    const start = new Date(ev.date_start + "T00:00:00");
    if (isNaN(start.getTime())) {
      undated.push(ev);
      continue;
    }

    const end = ev.date_end ? new Date(ev.date_end + "T00:00:00") : start;
    const validEnd = isNaN(end.getTime()) ? start : end;

    const cursor = new Date(start);
    const maxDays = 60;
    let days = 0;
    while (cursor <= validEnd && days < maxDays) {
      const key = dateKey(cursor);
      const existing = map.get(key) ?? [];
      existing.push(ev);
      map.set(key, existing);
      cursor.setDate(cursor.getDate() + 1);
      days++;
    }
  }

  return { map, undated };
}

function getUpcomingEvents(events: CalendarEvent[], limit = 8): CalendarEvent[] {
  const today = dateKey(new Date());
  return events
    .filter((e) => {
      if (!e.date_start) return false;
      const ds = e.date_start;
      const de = e.date_end ?? ds;
      return de >= today;
    })
    .sort((a, b) => (a.date_start ?? "").localeCompare(b.date_start ?? ""))
    .slice(0, limit);
}

function formatEventDate(ev: CalendarEvent): string {
  if (ev.date_display) return ev.date_display;
  if (!ev.date_start) return "TBD";
  const d = new Date(ev.date_start + "T00:00:00");
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (ev.date_end && ev.date_end !== ev.date_start) {
    const end = new Date(ev.date_end + "T00:00:00");
    return `${formatted} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  return formatted;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({ events }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { map: eventMap, undated } = useMemo(() => buildEventMap(events), [events]);
  const upcoming = useMemo(() => getUpcomingEvents(events), [events]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDay = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();

  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = Array(startDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  const goToday = () => {
    setCurrentMonth(startOfMonth(new Date()));
    setSelectedDate(dateKey(new Date()));
  };

  const selectedEvents = selectedDate ? eventMap.get(selectedDate) ?? [] : [];
  const selectedDateObj = selectedDate ? parseDateKey(selectedDate) : null;

  const todayKey = dateKey(new Date());

  const totalDated = events.filter((e) => e.date_start).length;
  const monthEventCount = (() => {
    let count = 0;
    const seen = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));
      for (const ev of eventMap.get(key) ?? []) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          count++;
        }
      }
    }
    return count;
  })();

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && (
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-muted uppercase tracking-wider">Coming Up Next</h3>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {upcoming.map((ev) => {
              const daysUntil = ev.date_start
                ? Math.max(0, Math.ceil((new Date(ev.date_start + "T00:00:00").getTime() - Date.now()) / 86400000))
                : null;

              return (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="flex min-w-[200px] shrink-0 flex-col rounded-xl bg-background p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-accent">
                      {formatEventDate(ev)}
                    </span>
                    <ScoreBadge score={ev.score} />
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-snug line-clamp-2">
                    {ev.name}
                  </p>
                  {ev.estimated_revenue_low != null && ev.estimated_revenue_high != null && (
                    <div className="mt-1.5">
                      <RevenueBadge low={ev.estimated_revenue_low} high={ev.estimated_revenue_high} compact />
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-xs text-muted truncate max-w-[120px]">
                      {ev.location ?? ev.event_type ?? ""}
                    </span>
                    {daysUntil !== null && daysUntil <= 30 && (
                      <span className={`text-xs font-bold ${daysUntil === 0 ? "text-foreground" : daysUntil <= 7 ? "text-accent" : "text-muted"}`}>
                        {daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `${daysUntil}d`}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">{formatMonthYear(currentMonth)}</h2>
              <span className="rounded-full bg-accent-light px-3 py-0.5 text-xs font-semibold text-accent">
                {monthEventCount} event{monthEventCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={goToday}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-light transition-colors"
              >
                Today
              </button>
              <button
                onClick={prevMonth}
                className="rounded-full p-2 text-muted hover:bg-accent-light hover:text-accent transition-colors"
                aria-label="Previous month"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button
                onClick={nextMonth}
                className="rounded-full p-2 text-muted hover:bg-accent-light hover:text-accent transition-colors"
                aria-label="Next month"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-t border-card-border">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="px-1 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-muted">
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {weeks.map((wk, wi) =>
              wk.map((day, di) => {
                if (!day) {
                  return <div key={`${wi}-${di}`} className="min-h-[80px] border-t border-r border-card-border/50 last:border-r-0 bg-subtle/50" />;
                }

                const key = dateKey(day);
                const dayEvents = eventMap.get(key) ?? [];
                const isSelected = selectedDate === key;
                const today = key === todayKey;
                const isPast = key < todayKey;

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(isSelected ? null : key)}
                    className={`min-h-[80px] border-t border-r border-card-border/50 last:border-r-0 p-1.5 text-left transition-all
                      ${isSelected ? "bg-accent-light ring-2 ring-accent" : "hover:bg-accent-light/40"}
                      ${isPast && !isSelected ? "opacity-50" : ""}
                    `}
                  >
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                      ${today ? "bg-accent text-white" : ""}
                    `}>
                      {day.getDate()}
                    </span>

                    {dayEvents.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-center gap-1 rounded px-1 py-0.5"
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scoreDotColor(ev.score)}`} />
                            <span className="truncate text-[10px] font-medium leading-tight">
                              {ev.name}
                            </span>
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <p className="pl-1 text-[10px] font-medium text-accent">
                            +{dayEvents.length - 3} more
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-5">
          {selectedDate && (
            <div className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-sm font-bold">
                {selectedDateObj?.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </h3>

              {selectedEvents.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No events on this day.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {selectedEvents.map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/events/${ev.id}`}
                      className="block rounded-xl bg-background p-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{ev.name}</p>
                        <ScoreBadge score={ev.score} />
                      </div>
                      {(ev.event_type || ev.location) && (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          {ev.event_type && <span>{ev.event_type}</span>}
                          {ev.location && <span className="truncate max-w-[180px]">{ev.location}</span>}
                        </div>
                      )}
                      {ev.estimated_attendance && (
                        <p className="mt-1 text-xs text-muted">
                          Est. attendance: {ev.estimated_attendance}
                        </p>
                      )}
                      {ev.estimated_revenue_low != null && ev.estimated_revenue_high != null && (
                        <div className="mt-1">
                          <RevenueBadge low={ev.estimated_revenue_low} high={ev.estimated_revenue_high} compact />
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {undated.length > 0 && (
            <div className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-sm font-bold">
                No Specific Date ({undated.length})
              </h3>
              <p className="mt-1 text-xs text-muted">
                Events without confirmed dates
              </p>
              <div className="mt-3 max-h-[400px] space-y-1.5 overflow-y-auto">
                {undated
                  .sort((a, b) => b.score - a.score)
                  .map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/events/${ev.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-accent-light/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{ev.name}</p>
                        {ev.date_display && (
                          <p className="text-xs text-muted">{ev.date_display}</p>
                        )}
                      </div>
                      <ScoreBadge score={ev.score} />
                    </Link>
                  ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold">Calendar Stats</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Dated events</dt>
                <dd className="font-bold">{totalDated}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Undated events</dt>
                <dd className="font-bold">{undated.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">This month</dt>
                <dd className="font-bold">{monthEventCount}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> 80+</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> 60-79</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> 40-59</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600" /> &lt;40</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
