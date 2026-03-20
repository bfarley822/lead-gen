const statusStyles: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  completed: {
    bg: "bg-subtle",
    text: "text-foreground",
    dot: "bg-foreground",
    label: "Completed",
  },
  running: {
    bg: "bg-accent-light",
    text: "text-accent",
    dot: "animate-pulse bg-accent",
    label: "Running",
  },
  failed: {
    bg: "bg-subtle",
    text: "text-foreground/60",
    dot: "bg-foreground/40",
    label: "Failed",
  },
  pending: {
    bg: "bg-subtle",
    text: "text-muted",
    dot: "bg-muted",
    label: "Pending",
  },
  unknown: {
    bg: "bg-subtle",
    text: "text-muted",
    dot: "bg-muted",
    label: "Unknown",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? statusStyles.unknown;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
