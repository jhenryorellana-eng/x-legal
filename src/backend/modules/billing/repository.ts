/**
 * Billing module — repository (data access layer).
 *
 * @module billing/repository
 */

import {
  createServerClient,
  createServiceClient,
} from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

export type PaymentPlanRow = Tables<"payment_plans">;
export type InstallmentRow = Tables<"installments">;
export type PaymentRow = Tables<"payments">;

// ---------------------------------------------------------------------------
// Payment plans
// ---------------------------------------------------------------------------

export async function findPlanByContractId(
  contractId: string,
): Promise<PaymentPlanRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payment_plans")
    .select("*")
    .eq("contract_id", contractId)
    .maybeSingle();

  return data ?? null;
}

export async function findPlanByCaseId(
  caseId: string,
): Promise<(PaymentPlanRow & { installments: InstallmentRow[] }) | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("payment_plans")
    .select("*, contracts!inner(case_id), installments(*)")
    .eq("contracts.case_id", caseId)
    .maybeSingle();

  if (!data) return null;

  // Flatten: strip the joined contracts object
  const plan = data as unknown as PaymentPlanRow & {
    installments: InstallmentRow[];
  };
  return plan;
}

export async function insertPaymentPlan(
  row: TablesInsert<"payment_plans">,
): Promise<PaymentPlanRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payment_plans")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `billing.repository: insertPaymentPlan failed — ${error?.message}`,
    );
  }
  return data;
}

// ---------------------------------------------------------------------------
// Installments
// ---------------------------------------------------------------------------

export async function insertInstallments(
  rows: TablesInsert<"installments">[],
): Promise<InstallmentRow[]> {
  if (rows.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("installments")
    .insert(rows)
    .select();

  if (error || !data) {
    throw new Error(
      `billing.repository: insertInstallments failed — ${error?.message}`,
    );
  }
  return data;
}

export async function findInstallmentById(
  installmentId: string,
): Promise<InstallmentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("installments")
    .select("*")
    .eq("id", installmentId)
    .maybeSingle();

  return data ?? null;
}

export async function updateInstallment(
  installmentId: string,
  fields: TablesUpdate<"installments">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("installments")
    .update(fields)
    .eq("id", installmentId);

  if (error) {
    throw new Error(
      `billing.repository: updateInstallment failed — ${error.message}`,
    );
  }
}

export async function listInstallmentsForPlan(
  paymentPlanId: string,
): Promise<InstallmentRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("installments")
    .select("*")
    .eq("payment_plan_id", paymentPlanId)
    .order("number");

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function insertPayment(
  row: TablesInsert<"payments">,
): Promise<PaymentRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payments")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `billing.repository: insertPayment failed — ${error?.message}`,
    );
  }
  return data;
}

export async function findPaymentById(
  paymentId: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  return data ?? null;
}

export async function updatePayment(
  paymentId: string,
  fields: TablesUpdate<"payments">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("payments")
    .update(fields)
    .eq("id", paymentId);

  if (error) {
    throw new Error(
      `billing.repository: updatePayment failed — ${error.message}`,
    );
  }
}

/**
 * Finds a pending Zelle payment for a given installment.
 * Used to prevent duplicate proof submissions.
 */
export async function findPendingZellePayment(
  installmentId: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("installment_id", installmentId)
    .eq("method", "zelle")
    .eq("status", "pending")
    .maybeSingle();

  return data ?? null;
}

// ---------------------------------------------------------------------------
// Installment lookup with case context for event payload
// ---------------------------------------------------------------------------

export interface InstallmentWithCase extends InstallmentRow {
  case_id: string; // derived via payment_plan → contract → case
}

/**
 * Finds the case_id associated with an installment via payment_plan → contract.
 * Returns null if the chain is broken.
 */
export async function findInstallmentCaseId(
  installmentId: string,
): Promise<string | null> {
  const supabase = createServiceClient();

  // installments.payment_plan_id → payment_plans.contract_id → contracts.case_id
  const { data } = await supabase
    .from("installments")
    .select(
      "id, payment_plan_id, payment_plans!inner(contract_id, contracts!inner(case_id))",
    )
    .eq("id", installmentId)
    .maybeSingle();

  if (!data) return null;

  const plan = (data as unknown as {
    payment_plans: { contracts: { case_id: string | null } };
  }).payment_plans;
  return plan?.contracts?.case_id ?? null;
}
