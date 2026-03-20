"use client";

import { useState, useRef, useEffect, useMemo } from "react";

export type FranchiseOption = {
  id: number;
  store_name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  state_initials: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

export function FranchisePicker({
  franchises,
  selected,
  onSelect,
  disabled,
}: {
  franchises: FranchiseOption[];
  selected: FranchiseOption | null;
  onSelect: (franchise: FranchiseOption | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return franchises;
    const q = query.toLowerCase();
    return franchises.filter(
      (f) =>
        f.store_name.toLowerCase().includes(q) ||
        f.city.toLowerCase().includes(q) ||
        f.state.toLowerCase().includes(q) ||
        f.state_initials.toLowerCase().includes(q) ||
        f.address.toLowerCase().includes(q) ||
        f.zip.includes(q)
    );
  }, [franchises, query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        if (!selected) setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selected]);

  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[highlightIndex];
      if (item) {
        onSelect(item);
        setQuery("");
        setOpen(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      if (!selected) setQuery("");
    }
  }

  function handleSelect(f: FranchiseOption) {
    onSelect(f);
    setQuery("");
    setOpen(false);
  }

  function handleClear() {
    onSelect(null);
    setQuery("");
    inputRef.current?.focus();
  }

  const displayValue = selected
    ? `${selected.store_name} — ${selected.city}, ${selected.state_initials}`
    : query;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? query : displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            if (selected) onSelect(null);
          }}
          onFocus={() => {
            setOpen(true);
            if (selected) {
              setQuery("");
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Search franchise locations..."
          className={`w-full rounded-xl border border-card-border bg-background pl-10 pr-10 py-2.5 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-50 ${
            selected ? "font-medium" : ""
          }`}
        />
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        {selected && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-card-border bg-card shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted">
              No franchise locations found
            </li>
          ) : (
            filtered.map((f, i) => (
              <li
                key={f.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(f);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`cursor-pointer px-4 py-3 text-sm transition-colors ${
                  i === highlightIndex
                    ? "bg-accent-light text-accent"
                    : "hover:bg-accent-light/40"
                } ${selected?.id === f.id ? "font-semibold" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{f.store_name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {f.city}, {f.state_initials}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted truncate">
                  {f.address}
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
