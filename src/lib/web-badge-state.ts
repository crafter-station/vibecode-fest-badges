import {
  findActiveWebAttempt,
  findCompletedWebBadge,
  findLatestRetryableWebAttempt,
} from "@/lib/badges";
import { getWebSession } from "@/lib/web-badge-auth";

export type CreateBadgeState =
  | { status: "needs_email" }
  | { status: "ready_to_upload"; displayName: string | null }
  | { status: "generating"; badgeNumber: number | null }
  | { status: "rejected_retry_allowed"; error: string | null }
  | { status: "failed_retry_allowed"; error: string | null }
  | { status: "completed"; badgeNumber: number; badgeImageUrl: string };

export const getCreateBadgeState = async (): Promise<CreateBadgeState> => {
  const session = await getWebSession();
  if (!session) {
    return { status: "needs_email" };
  }

  const completedBadge = await findCompletedWebBadge(session.webParticipantId);
  if (completedBadge) {
    return {
      status: "completed",
      badgeNumber: completedBadge.badgeNumber,
      badgeImageUrl: completedBadge.badgeImageUrl,
    };
  }

  const activeAttempt = await findActiveWebAttempt(session.webParticipantId);
  if (activeAttempt) {
    return {
      status: "generating",
      badgeNumber: activeAttempt.badgeNumber,
    };
  }

  const retryableAttempt = await findLatestRetryableWebAttempt(
    session.webParticipantId,
  );
  if (retryableAttempt?.status === "rejected") {
    return {
      status: "rejected_retry_allowed",
      error: retryableAttempt.generationError,
    };
  }
  if (retryableAttempt?.status === "failed") {
    return {
      status: "failed_retry_allowed",
      error: retryableAttempt.generationError,
    };
  }

  return {
    status: "ready_to_upload",
    displayName: session.participantDisplayName,
  };
};
