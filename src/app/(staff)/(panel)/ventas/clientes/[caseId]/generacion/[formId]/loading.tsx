import { ReviewSkeleton } from "@/frontend/features/legal/revision/review-skeleton";

/** Streaming shell — the split review opens instantly while the loader streams. */
export default function Loading() {
  return <ReviewSkeleton />;
}
