import type { Metadata } from "next";
import { CreateBadgeClient } from "./create-badge-client";

export const metadata: Metadata = {
  title: "Create Badge | VCF Badges",
  description: "Create your private Vibe Code Fest Badge.",
};

export default function Page() {
  return <CreateBadgeClient />;
}
