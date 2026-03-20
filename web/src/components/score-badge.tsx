export function ScoreBadge({ score }: { score: number }) {
  let bg: string;
  let text: string;

  if (score >= 80) {
    bg = "bg-emerald-100 dark:bg-emerald-900/30";
    text = "text-emerald-700 dark:text-emerald-300";
  } else if (score >= 60) {
    bg = "bg-amber-100 dark:bg-amber-900/30";
    text = "text-amber-700 dark:text-amber-300";
  } else if (score >= 40) {
    bg = "bg-orange-100 dark:bg-orange-900/30";
    text = "text-orange-600 dark:text-orange-300";
  } else {
    bg = "bg-subtle";
    text = "text-muted";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-bold ${bg} ${text}`}
    >
      {score}
    </span>
  );
}
