import type { Metadata } from "next";
import { BadgesPage } from "./badges-page";

export const metadata: Metadata = {
  title: "Badges | VCF Badges",
  description: "Browse generated VCF badges.",
};

export default function Page() {
  return <BadgesPage page={1} />;
}
