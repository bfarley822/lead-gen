import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocationEvents, getEventTypes } from "@/lib/db";
import { LocationView } from "@/components/location-view";

export const dynamic = "force-dynamic";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: rawCity } = await params;
  const city = decodeURIComponent(rawCity);
  const events = await getLocationEvents(city);

  if (events.length === 0) {
    notFound();
  }

  const eventTypes = await getEventTypes(city);
  const avgScore =
    events.length > 0
      ? Math.round(events.reduce((s, e) => s + e.score, 0) / events.length)
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
        >
          &larr; Dashboard
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{city}</h1>
        <div className="mt-3 flex gap-3">
          <span className="rounded-full bg-accent-light px-4 py-1.5 text-sm font-bold text-accent">
            {events.length} active events
          </span>
          <span className="rounded-full bg-subtle px-4 py-1.5 text-sm font-semibold text-muted">
            Avg score: {avgScore}
          </span>
          <span className="rounded-full bg-subtle px-4 py-1.5 text-sm font-bold text-foreground">
            {events.filter((e) => e.score >= 80).length} high-potential
          </span>
        </div>
      </div>

      <LocationView events={events} eventTypes={eventTypes} />
    </div>
  );
}
