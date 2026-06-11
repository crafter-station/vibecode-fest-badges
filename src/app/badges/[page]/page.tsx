import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgesPage } from "../badges-page";

type PageProps = {
  params: Promise<{
    page: string;
  }>;
};

export const metadata: Metadata = {
  title: "Badges | VCF Badges",
  description: "Browse generated VCF badges.",
};

export default async function Page({ params }: PageProps) {
  const { page: pageParam } = await params;
  const page = Number(pageParam);

  if (!Number.isInteger(page) || page < 1) {
    notFound();
  }

  return <BadgesPage page={page} />;
}
