import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/db";
import { ScoreBadge } from "@/components/score-badge";
import { RevenueBadge } from "@/components/revenue-badge";

export const dynamic = "force-dynamic";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <div className="flex gap-4 border-b border-card-border/50 py-4 last:border-0">
      <dt className="w-40 shrink-0 text-sm font-bold text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) notFound();

  const result = await getEvent(id);
  if (!result) notFound();

  const { event, sourceUrls } = result;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/locations/${encodeURIComponent(event.city)}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
        >
          &larr; {event.city}
        </Link>
      </div>

      <div className="rounded-2xl bg-card shadow-md">
        <div className="border-b border-card-border/50 px-7 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{event.name}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                {event.event_type && (
                  <span className="rounded-full bg-accent-light px-3 py-1 text-xs font-bold text-accent">
                    {event.event_type}
                  </span>
                )}
                {event.is_recurring === 1 && (
                  <span className="rounded-full bg-accent-light px-3 py-1 text-xs font-bold text-accent">
                    Recurring
                  </span>
                )}
                <span className="rounded-full bg-subtle px-3 py-1 text-xs font-semibold text-muted">
                  {event.city}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-muted uppercase tracking-wider">Score</div>
              <div className="mt-1.5">
                <ScoreBadge score={event.score} />
              </div>
            </div>
          </div>
        </div>

        <div className="px-7 py-5">
          <dl>
            <DetailRow label="Location">{event.location}</DetailRow>
            <DetailRow label="Date">
              {event.date_display ??
                (event.date_start
                  ? `${event.date_start}${event.date_end ? ` to ${event.date_end}` : ""}`
                  : null)}
            </DetailRow>
            <DetailRow label="Est. Attendance">
              {event.estimated_attendance}
            </DetailRow>
            <DetailRow label="Est. Revenue">
              {event.estimated_revenue_low != null && event.estimated_revenue_high != null ? (
                <RevenueBadge low={event.estimated_revenue_low} high={event.estimated_revenue_high} />
              ) : null}
            </DetailRow>
            <DetailRow label="Description">{event.description}</DetailRow>
            <DetailRow label="Organizer">{event.organizer}</DetailRow>
            <DetailRow label="Contact">{event.contact_info}</DetailRow>
            <DetailRow label="Best Contact Method">
              {event.contact_method ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-light px-3 py-1 text-xs font-bold text-accent capitalize">
                  {event.contact_method.replace(/_/g, " ")}
                </span>
              ) : null}
            </DetailRow>
            <DetailRow label="Phone">
              {event.contact_phone ? (
                <a
                  href={`tel:${event.contact_phone}`}
                  className="font-medium text-accent hover:text-accent-hover transition-colors"
                >
                  {event.contact_phone}
                </a>
              ) : null}
            </DetailRow>
            <DetailRow label="Email">
              {event.contact_email ? (
                <a
                  href={`mailto:${event.contact_email}`}
                  className="font-medium text-accent hover:text-accent-hover transition-colors break-all"
                >
                  {event.contact_email}
                </a>
              ) : null}
            </DetailRow>
            <DetailRow label="Contact Page">
              {event.contact_url ? (
                <a
                  href={event.contact_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:text-accent-hover transition-colors break-all"
                >
                  {event.contact_url}
                </a>
              ) : null}
            </DetailRow>
            <DetailRow label="Registration">
              {event.registration_url ? (
                <a
                  href={event.registration_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:text-accent-hover transition-colors break-all"
                >
                  {event.registration_url}
                </a>
              ) : null}
            </DetailRow>
          </dl>
        </div>
      </div>

      {event.suggested_message && (
        <div className="rounded-2xl bg-card px-7 py-5 shadow-sm">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
            Suggested Outreach Message
          </h2>
          <div className="mt-3 rounded-xl bg-accent-light/60 px-5 py-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{event.suggested_message}</p>
          </div>
          <div className="mt-3 flex gap-2">
            {event.contact_email && (
              <a
                href={`mailto:${event.contact_email}?subject=${encodeURIComponent(`Crumbl Cookies - Vendor Inquiry for ${event.name}`)}&body=${encodeURIComponent(event.suggested_message)}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent-hover transition-colors"
              >
                Send via Email
              </a>
            )}
            {event.contact_phone && (
              <a
                href={`tel:${event.contact_phone}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-4 py-2 text-xs font-bold text-foreground hover:bg-card-border transition-colors"
              >
                Call {event.contact_phone}
              </a>
            )}
            {event.contact_url && !event.contact_email && (
              <a
                href={event.contact_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-4 py-2 text-xs font-bold text-foreground hover:bg-card-border transition-colors"
              >
                Open Contact Page
              </a>
            )}
          </div>
        </div>
      )}

      {event.reasoning && (
        <div className="rounded-2xl bg-card px-7 py-5 shadow-sm">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
            Scoring Reasoning
          </h2>
          <p className="mt-3 text-sm leading-relaxed">{event.reasoning}</p>
        </div>
      )}

      {event.revenue_reasoning && (
        <div className="rounded-2xl bg-card px-7 py-5 shadow-sm">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
            Revenue Estimate
          </h2>
          <div className="mt-3 flex items-center gap-3">
            <RevenueBadge low={event.estimated_revenue_low} high={event.estimated_revenue_high} />
          </div>
          <p className="mt-3 text-sm leading-relaxed">{event.revenue_reasoning}</p>
        </div>
      )}

      {sourceUrls.length > 0 && (
        <div className="rounded-2xl bg-card px-7 py-5 shadow-sm">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
            Source URLs ({sourceUrls.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {sourceUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent hover:text-accent-hover transition-colors break-all"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl bg-card px-7 py-5 shadow-sm">
        <h2 className="text-sm font-bold text-muted uppercase tracking-wider">Metadata</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted">Created:</span>{" "}
            <span className="font-medium">{formatTimestamp(event.created_at)}</span>
          </div>
          <div>
            <span className="text-muted">Researched:</span>{" "}
            <span className="font-medium">{formatTimestamp(event.researched_at)}</span>
          </div>
          <div>
            <span className="text-muted">Updated:</span>{" "}
            <span className="font-medium">{formatTimestamp(event.updated_at)}</span>
          </div>
          <div>
            <span className="text-muted">Status:</span>{" "}
            <span className="font-medium">{event.status}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
