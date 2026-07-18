import { WizardSkeleton } from "@/frontend/features/form-wizard/wizard-skeleton";

/** Streaming shell — the wizard opens instantly while getFormForClient loads. */
export default function Loading() {
  return <WizardSkeleton />;
}
