import { getCreateBadgeState } from "@/lib/web-badge-state";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getCreateBadgeState());
}
