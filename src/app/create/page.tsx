import type { Metadata } from "next";
import { getCreateBadgeState } from "@/lib/web-badge-state";
import { CreateBadgeClient } from "./create-badge-client";

export const metadata: Metadata = {
  title: "Create Badge | VCF Badges",
  description: "Create your Vibe Code Fest badge from the web.",
};

export default async function Page() {
  const initialState = await getCreateBadgeState();

  return <CreateBadgeClient initialState={initialState} />;
}
