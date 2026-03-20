"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { CanonicalEvent } from "@/lib/db";
import { ScoreBadge } from "./score-badge";
import { DistanceBadge } from "./distance-badge";
import { RevenueBadge } from "./revenue-badge";

type SortKey = "score" | "name" | "date" | "attendance" | "revenue";
type SortDir = "asc" | "desc";

function parseAttendance(val: string | null): number {
  if (!val) return 0;
  const nums = val.match(/[\d,]+/g);
  if (!nums) return 0;
  return Math.max(...nums.map((n) => parseInt(n.replace(/,/g, ""), 10)));
}

export function EventTable({
  events,
  eventTypes,
}: {
  events: CanonicalEvent[];
  eventTypes: string[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [minScore, setMinScore] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = events;

    if (minScore > 0) {
      result = result.filter((e) => e.score >= minScore);
    }
    if (typeFilter) {
      result = result.filter((e) => e.event_type === typeFilter);
    }
    if (recurringOnly) {
      result = result.filter((e) => e.is_recurring === 1);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.location?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score":
          cmp = a.score - b.score;
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "date":
          cmp = (a.date_start ?? "9999").localeCompare(b.date_start ?? "9999");
          break;
        case "attendance":
          cmp = parseAttendance(a.estimated_attendance) - parseAttendance(b.estimated_attendance);
          break;
        case "revenue":
          cmp = (a.estimated_revenue_high ?? 0) - (b.estimated_revenue_high ?? 0);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [events, minScore, typeFilter, recurringOnly, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " \u25BC" : " \u25B2";
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter events..."
            className="rounded-full bg-card px-4 py-2 text-sm shadow-sm outline-none transition-shadow focus:shadow-md focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Min Score</label>
          <input
            type="number"
            value={minScore || ""}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            placeholder="0"
            min={0}
            max={100}
            className="w-20 rounded-full bg-card px-4 py-2 text-sm shadow-sm outline-none transition-shadow focus:shadow-md focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-full bg-card px-4 py-2 text-sm shadow-sm outline-none transition-shadow focus:shadow-md focus:ring-2 focus:ring-accent/30"
          >
            <option value="">All types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm shadow-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recurringOnly}
            onChange={(e) => setRecurringOnly(e.target.checked)}
            className="rounded accent-accent"
          />
          Recurring only
        </label>

        <span className="ml-auto rounded-full bg-accent-light px-4 py-2 text-sm font-semibold text-accent">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th
                className="cursor-pointer px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                onClick={() => toggleSort("score")}
              >
                Score{sortIcon("score")}
              </th>
              <th
                className="cursor-pointer px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                onClick={() => toggleSort("name")}
              >
                Event{sortIcon("name")}
              </th>
              <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Type
              </th>
              <th
                className="cursor-pointer px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                onClick={() => toggleSort("date")}
              >
                Date{sortIcon("date")}
              </th>
              <th
                className="cursor-pointer px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                onClick={() => toggleSort("attendance")}
              >
                Attendance{sortIcon("attendance")}
              </th>
              <th
                className="cursor-pointer px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                onClick={() => toggleSort("revenue")}
              >
                Est. Revenue{sortIcon("revenue")}
              </th>
              <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Location
              </th>
              {events.some((e) => e.distance_miles != null) && (
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Distance
                </th>
              )}
              <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Contact
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {filtered.map((event) => (
              <tr
                key={event.id}
                className="transition-colors hover:bg-accent-light/40"
              >
                <td className="px-5 py-4">
                  <ScoreBadge score={event.score} />
                </td>
                <td className="max-w-xs px-5 py-4">
                  <Link
                    href={`/events/${event.id}`}
                    className="font-semibold hover:text-accent transition-colors"
                  >
                    {event.name}
                  </Link>
                  {event.is_recurring === 1 && (
                    <span className="ml-2 rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent">
                      Recurring
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-muted">
                  {event.event_type ?? "-"}
                </td>
                <td className="max-w-[150px] px-5 py-4">
                  <span className="line-clamp-2">{event.date_display ?? event.date_start ?? "-"}</span>
                </td>
                <td className="px-5 py-4 whitespace-nowrap">
                  {event.estimated_attendance ?? "-"}
                </td>
                <td className="px-5 py-4 whitespace-nowrap">
                  <RevenueBadge
                    low={event.estimated_revenue_low ?? null}
                    high={event.estimated_revenue_high ?? null}
                    compact
                  />
                  {event.estimated_revenue_low == null && "-"}
                </td>
                <td className="max-w-[200px] truncate px-5 py-4 text-muted">
                  {event.location ?? "-"}
                </td>
                {events.some((e) => e.distance_miles != null) && (
                  <td className="px-5 py-4 whitespace-nowrap">
                    <DistanceBadge
                      distanceMiles={event.distance_miles ?? null}
                      isClosest={event.is_closest === 1}
                      closestStoreName={event.closest_store_name ?? null}
                    />
                  </td>
                )}
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1">
                    {event.contact_email && (
                      <a href={`mailto:${event.contact_email}`} className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors" title={event.contact_email}>
                        Email
                      </a>
                    )}
                    {event.contact_phone && (
                      <a href={`tel:${event.contact_phone}`} className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors" title={event.contact_phone}>
                        Phone
                      </a>
                    )}
                    {!event.contact_email && !event.contact_phone && event.contact_url && (
                      <a href={event.contact_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-muted hover:text-foreground transition-colors">
                        Web
                      </a>
                    )}
                    {!event.contact_email && !event.contact_phone && !event.contact_url && (
                      <span className="text-xs text-muted">-</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-16 text-center text-muted">
                  No events match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
