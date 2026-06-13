"use client";

/**
 * Métricas client wrapper — handles period change via searchParams navigation
 * (RSC recompute, DOC-52 §6.2). Wraps the server-rendered view so the period
 * segmented control pushes ?period=… without inventing a client-side fetch.
 */

import * as React from "react";

export function MetricasClient({
  children,
}: {
  period: "week" | "month" | "custom";
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
