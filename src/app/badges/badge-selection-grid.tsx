"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Badge = {
  id: number;
  contactName: string | null;
  badgeNumber: number | null;
  badgeImageUrl: string | null;
};

type BadgeSelectionGridProps = {
  badges: Badge[];
};

const STORAGE_KEY = "vcf-selected-badge-ids";

const formatBadgeNumber = (badgeNumber: number | null) =>
  String(badgeNumber ?? 0).padStart(4, "0");

export function BadgeSelectionGrid({ badges }: BadgeSelectionGridProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [hasLoadedSelection, setHasLoadedSelection] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      setHasLoadedSelection(true);
      return;
    }

    try {
      const parsedValue = JSON.parse(storedValue);

      if (Array.isArray(parsedValue)) {
        setSelectedIds(
          parsedValue.filter(
            (value): value is number =>
              typeof value === "number" && Number.isInteger(value),
          ),
        );
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    setHasLoadedSelection(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSelection) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
  }, [hasLoadedSelection, selectedIds]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleBadgeIds = badges.map((badge) => badge.id);
  const allVisibleSelected = visibleBadgeIds.every((id) =>
    selectedIdSet.has(id),
  );
  const printHref = `/badges/print?ids=${encodeURIComponent(selectedIds.join(","))}`;

  const toggleBadge = (badgeId: number) => {
    setSelectedIds((currentIds) =>
      currentIds.includes(badgeId)
        ? currentIds.filter((id) => id !== badgeId)
        : [...currentIds, badgeId],
    );
  };

  const toggleVisibleBadges = () => {
    setSelectedIds((currentIds) => {
      if (allVisibleSelected) {
        return currentIds.filter((id) => !visibleBadgeIds.includes(id));
      }

      return Array.from(new Set([...currentIds, ...visibleBadgeIds]));
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-3xl border-4 border-stone-950 bg-white p-4 shadow-[7px_7px_0_#1c1917] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-black text-2xl">Print selection</p>
          <p className="text-sm text-stone-600">
            {selectedIds.length} badge{selectedIds.length === 1 ? "" : "s"}{" "}
            selected
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-full border-2 border-stone-950 px-4 py-2 font-bold text-xs uppercase tracking-widest transition-colors hover:bg-stone-950 hover:text-white"
            onClick={toggleVisibleBadges}
            type="button"
          >
            {allVisibleSelected ? "Unselect page" : "Select page"}
          </button>
          <button
            className="rounded-full border-2 border-stone-950 px-4 py-2 font-bold text-xs uppercase tracking-widest transition-colors hover:bg-stone-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selectedIds.length === 0}
            onClick={() => setSelectedIds([])}
            type="button"
          >
            Clear
          </button>
          <a
            aria-disabled={selectedIds.length === 0}
            className="rounded-full border-2 border-stone-950 bg-stone-950 px-4 py-2 font-bold text-white text-xs uppercase tracking-widest transition-colors hover:bg-white hover:text-stone-950 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={selectedIds.length > 0 ? printHref : "#"}
          >
            Print Hagaki
          </a>
        </div>
      </div>

      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {badges.map((badge) => {
          const isSelected = selectedIdSet.has(badge.id);
          const formattedBadgeNumber = formatBadgeNumber(badge.badgeNumber);

          return (
            <article
              className={`group overflow-hidden rounded-3xl border-4 bg-white shadow-[7px_7px_0_#1c1917] transition-transform hover:-translate-y-1 ${
                isSelected ? "border-emerald-500" : "border-stone-950"
              }`}
              key={badge.id}
            >
              <button
                aria-pressed={isSelected}
                className="relative block aspect-square w-full bg-stone-200 text-left"
                onClick={() => toggleBadge(badge.id)}
                type="button"
              >
                <Image
                  alt={`Badge #${formattedBadgeNumber}`}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  src={badge.badgeImageUrl ?? ""}
                  unoptimized
                />
                <span
                  className={`absolute top-3 left-3 rounded-full border-2 border-stone-950 px-3 py-1 font-black text-xs uppercase tracking-widest ${
                    isSelected ? "bg-emerald-400" : "bg-white"
                  }`}
                >
                  {isSelected ? "Selected" : "Select"}
                </span>
              </button>
              <div className="flex items-center justify-between gap-3 border-stone-950 border-t-4 p-4">
                <div className="min-w-0">
                  <p className="font-black text-2xl">#{formattedBadgeNumber}</p>
                  {badge.contactName ? (
                    <p className="truncate text-sm text-stone-600">
                      {badge.contactName}
                    </p>
                  ) : null}
                </div>
                <a
                  className="rounded-full border-2 border-stone-950 px-3 py-1 font-bold text-xs uppercase tracking-widest transition-colors hover:bg-stone-950 hover:text-white"
                  href={badge.badgeImageUrl ?? ""}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
