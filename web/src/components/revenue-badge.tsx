function formatDollars(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${amount.toLocaleString()}`;
}

export function RevenueBadge({
  low,
  high,
  compact = false,
}: {
  low: number | null;
  high: number | null;
  compact?: boolean;
}) {
  if (low == null || high == null) return null;

  const bg = high >= 5000
    ? "bg-emerald-50 dark:bg-emerald-900/20"
    : high >= 2000
      ? "bg-amber-50 dark:bg-amber-900/20"
      : "bg-gray-50 dark:bg-gray-800/40";

  const text = high >= 5000
    ? "text-emerald-700 dark:text-emerald-300"
    : high >= 2000
      ? "text-amber-700 dark:text-amber-300"
      : "text-gray-600 dark:text-gray-400";

  if (compact) {
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${bg} ${text}`}>
        {formatDollars(low)}–{formatDollars(high)}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-bold ${bg} ${text}`}>
      {formatDollars(low)} – {formatDollars(high)}
    </span>
  );
}
