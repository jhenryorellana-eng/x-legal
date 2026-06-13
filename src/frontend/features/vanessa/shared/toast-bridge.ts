"use client";

/**
 * Thin toast bridge for Vanessa views — stable `useToast()` returning
 * success/error helpers backed by the shared sonner instance (BrandToaster,
 * DOC-01 §5.3). Toast copy is normative per view (DOC-52 §0.3); the bottom
 * pill styling comes from BrandToaster.
 */

import { toast } from "@/frontend/components/desktop/toast";

export function useToast() {
  return {
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    info: (message: string) => toast(message),
  };
}
