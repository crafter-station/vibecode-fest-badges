import { and, inArray, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/db";
import { badges as badgesTable } from "@/db/schema";
import { PrintButton } from "./print-button";

type PageProps = {
  searchParams: Promise<{
    ids?: string | string[];
  }>;
};

type PrintableBadge = {
  id: number;
  badgeNumber: number;
  badgeImageUrl: string;
};

export const metadata: Metadata = {
  title: "Print Badges | VCF Badges",
  description: "Print selected VCF badges on Hagaki postcard paper.",
};

const selectedIdsFromSearchParams = (ids: string | string[] | undefined) => {
  const idsValue = Array.isArray(ids) ? ids.join(",") : ids;

  if (!idsValue) {
    return [];
  }

  return Array.from(
    new Set(
      idsValue
        .split(",")
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
};

const chunkBadges = <T,>(badges: T[], size: number) =>
  Array.from({ length: Math.ceil(badges.length / size) }, (_, index) =>
    badges.slice(index * size, index * size + size),
  );

const formatBadgeNumber = (badgeNumber: number | null) =>
  String(badgeNumber ?? 0).padStart(4, "0");

export default async function Page({ searchParams }: PageProps) {
  const { ids } = await searchParams;
  const selectedIds = selectedIdsFromSearchParams(ids);

  const badges =
    selectedIds.length > 0
      ? await db
          .select({
            id: badgesTable.id,
            badgeNumber: badgesTable.badgeNumber,
            badgeImageUrl: badgesTable.badgeImageUrl,
          })
          .from(badgesTable)
          .where(
            and(
              inArray(badgesTable.id, selectedIds),
              isNotNull(badgesTable.badgeImageUrl),
            ),
          )
      : [];

  const badgesById = new Map(badges.map((badge) => [badge.id, badge]));
  const orderedBadges = selectedIds
    .map((id) => badgesById.get(id))
    .filter((badge): badge is PrintableBadge => badge !== undefined);
  const pages = chunkBadges(orderedBadges, 2);

  return (
    <main className="min-h-screen bg-neutral-200 p-4 text-stone-950 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto mb-6 flex max-w-3xl flex-col gap-3 rounded-2xl border-4 border-stone-950 bg-white p-4 shadow-[6px_6px_0_#1c1917] print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-stone-600">
            Hagaki print layout
          </p>
          <h1 className="mt-1 font-black text-3xl">
            {orderedBadges.length} badges
          </h1>
          <p className="text-sm text-stone-600">
            Paper size: 148mm x 100mm. Two badges per page.
          </p>
          <p className="mt-2 max-w-md text-sm text-stone-700">
            Use Export PDF, then open/save the PDF and print it from macOS
            Preview with native printer settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-full border-2 border-stone-950 px-4 py-2 font-bold text-xs uppercase tracking-widest transition-colors hover:bg-stone-950 hover:text-white"
            href="/badges"
          >
            Back
          </Link>
          <PrintButton />
        </div>
      </div>

      {orderedBadges.length === 0 ? (
        <section className="mx-auto max-w-3xl rounded-2xl border-4 border-stone-950 bg-white p-8 shadow-[6px_6px_0_#1c1917] print:hidden">
          <h2 className="font-black text-2xl">No badges selected.</h2>
          <p className="mt-2 text-stone-600">
            Go back to the badge wall, select badges, then open the Hagaki print
            layout.
          </p>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-6 print:gap-0">
          {pages.map((pageBadges, pageIndex) => (
            <section
              className={`box-border flex h-[100mm] w-[148mm] flex-row items-center justify-between overflow-hidden bg-white ${
                pageIndex < pages.length - 1 ? "print:break-after-page" : ""
              }`}
              key={pageBadges.map((badge) => badge.id).join("-") || pageIndex}
            >
              {pageBadges.map((badge) => (
                <Image
                  alt={`Badge #${formatBadgeNumber(badge.badgeNumber)}`}
                  className="w-[73.4mm] max-h-full object-contain"
                  height={1350}
                  key={badge.id}
                  src={badge.badgeImageUrl ?? ""}
                  unoptimized
                  width={1080}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
