import Link from "next/link";
import { notFound } from "next/navigation";
import { getPipelineRun } from "@/lib/db";
import { LiveLog } from "@/components/live-log";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) notFound();

  const run = await getPipelineRun(id);
  if (!run) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover transition-colors">
          &larr; All Runs
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Run #{run.id} — {run.city}
        </h1>
        {run.store_address && (
          <p className="mt-1.5 text-sm text-muted">{run.store_address}</p>
        )}
      </div>

      <LiveLog runId={run.id} initial={run} />
    </div>
  );
}
