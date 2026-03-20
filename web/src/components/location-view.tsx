"use client";

import { useState } from "react";
import { EventTable } from "./event-table";
import { CalendarView } from "./calendar-view";

type CanonicalEvent = {
  id: number;
  name: string;
  event_type: string | null;
  location: string | null;
  date_start: string | null;
  date_end: string | null;
  date_display: string | null;
  estimated_attendance: string | null;
  is_recurring: number;
  description: string | null;
  organizer: string | null;
  contact_info: string | null;
  contact_method: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_url: string | null;
  registration_url: string | null;
  suggested_message: string | null;
  score: number;
  reasoning: string | null;
  estimated_revenue_low: number | null;
  estimated_revenue_high: number | null;
  revenue_reasoning: string | null;
  status: string;
  city: string;
  created_at: string;
  researched_at: string | null;
  updated_at: string;
  is_closest?: number;
  distance_miles?: number | null;
  closest_store_name?: string | null;
};

type ViewMode = "calendar" | "table";

export function LocationView({
  events,
  eventTypes,
}: {
  events: CanonicalEvent[];
  eventTypes: string[];
}) {
  const [view, setView] = useState<ViewMode>("calendar");

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full bg-card p-1 shadow-sm">
        <button
          onClick={() => setView("calendar")}
          className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-all ${
            view === "calendar"
              ? "bg-accent text-white shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 1.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M11 1.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Calendar
        </button>
        <button
          onClick={() => setView("table")}
          className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-all ${
            view === "table"
              ? "bg-accent text-white shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M2 8H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M2 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Table
        </button>
      </div>

      {view === "calendar" ? (
        <CalendarView events={events} />
      ) : (
        <EventTable events={events} eventTypes={eventTypes} />
      )}
    </div>
  );
}
