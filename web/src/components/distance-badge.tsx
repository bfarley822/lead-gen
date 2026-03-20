export function DistanceBadge({
  distanceMiles,
  isClosest,
  closestStoreName,
}: {
  distanceMiles: number | null;
  isClosest: boolean;
  closestStoreName: string | null;
}) {
  if (distanceMiles == null) return <span className="text-xs text-muted">-</span>;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm tabular-nums">{distanceMiles} mi</span>
      {isClosest ? (
        <span className="inline-flex w-fit rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Closest
        </span>
      ) : closestStoreName ? (
        <span
          className="inline-flex w-fit rounded-full bg-subtle px-2 py-0.5 text-xs text-muted"
          title={`Closest store: ${closestStoreName}`}
        >
          {closestStoreName}
        </span>
      ) : null}
    </div>
  );
}
