import { asc, count, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { badges as badgesTable } from "@/db/schema";
import { BadgeSelectionGrid } from "./badge-selection-grid";

const BADGES_PER_PAGE = 20;

type BadgesPageProps = {
  page: number;
};

const badgesWhere = isNotNull(badgesTable.badgeImageUrl);

const pageHref = (page: number) => (page === 1 ? "/badges" : `/badges/${page}`);

export async function BadgesPage({ page }: BadgesPageProps) {
  const offset = (page - 1) * BADGES_PER_PAGE;

  const [totalResult, badges] = await Promise.all([
    db.select({ value: count() }).from(badgesTable).where(badgesWhere),
    db
      .select({
        id: badgesTable.id,
        contactName: badgesTable.participantDisplayName,
        badgeNumber: badgesTable.badgeNumber,
        badgeImageUrl: badgesTable.badgeImageUrl,
      })
      .from(badgesTable)
      .where(badgesWhere)
      .orderBy(asc(badgesTable.badgeNumber))
      .limit(BADGES_PER_PAGE)
      .offset(offset),
  ]);

  const totalBadges = totalResult[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalBadges / BADGES_PER_PAGE));

  if (page > totalPages && totalBadges > 0) {
    notFound();
  }

  const pageNumbers = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  ).filter(
    (pageNumber) =>
      pageNumber === 1 ||
      pageNumber === totalPages ||
      Math.abs(pageNumber - page) <= 2,
  );

  return (
    <main className="min-h-screen bg-[#f7f0de] px-5 py-8 text-stone-950 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-stone-950 border-b-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-sm uppercase tracking-[0.35em] text-stone-600">
              VCF Badges
            </p>
            <h1 className="mt-2 font-black text-5xl tracking-tight sm:text-7xl">
              Badge Wall
            </h1>
          </div>
          <p className="max-w-sm font-mono text-sm text-stone-700 uppercase tracking-widest sm:text-right">
            Page {page} of {totalPages} / {totalBadges} generated badges
          </p>
        </header>

        {badges.length === 0 ? (
          <section className="rounded-3xl border-4 border-stone-950 bg-white p-10 shadow-[10px_10px_0_#1c1917]">
            <h2 className="font-black text-3xl">No badges yet.</h2>
            <p className="mt-3 max-w-xl text-stone-700">
              Generated badges will appear here once badge creation finishes.
            </p>
          </section>
        ) : (
          <BadgeSelectionGrid badges={badges} />
        )}

        {totalPages > 1 ? (
          <nav
            aria-label="Badge pages"
            className="flex flex-wrap items-center justify-center gap-3 pt-2"
          >
            {page > 1 ? (
              <Link
                className="rounded-full border-4 border-stone-950 bg-white px-5 py-3 font-black shadow-[4px_4px_0_#1c1917]"
                href={pageHref(page - 1)}
              >
                Previous
              </Link>
            ) : null}

            {pageNumbers.map((pageNumber, index) => {
              const previousPage = pageNumbers[index - 1];
              const hasGap =
                previousPage !== undefined && pageNumber - previousPage > 1;

              return (
                <div className="flex items-center gap-3" key={pageNumber}>
                  {hasGap ? <span className="font-black">...</span> : null}
                  <Link
                    aria-current={pageNumber === page ? "page" : undefined}
                    className={`rounded-full border-4 border-stone-950 px-5 py-3 font-black shadow-[4px_4px_0_#1c1917] ${
                      pageNumber === page
                        ? "bg-stone-950 text-white"
                        : "bg-white"
                    }`}
                    href={pageHref(pageNumber)}
                  >
                    {pageNumber}
                  </Link>
                </div>
              );
            })}

            {page < totalPages ? (
              <Link
                className="rounded-full border-4 border-stone-950 bg-white px-5 py-3 font-black shadow-[4px_4px_0_#1c1917]"
                href={pageHref(page + 1)}
              >
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
