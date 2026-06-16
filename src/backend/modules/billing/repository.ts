/**
 * Billing module — repository (data access layer).
 *
 * F2: createPaymentPlan, registerZellePayment, getPaymentPlanForCase
 * F6-Ola1: getAccountStatement, findNextDueInstallment, findActiveStripePayment,
 *           findPaymentByIntentId, findPaymentBySessionId, findStripeCustomer,
 *           upsertStripeCustomer, insertLedgerIfAbsent
 *
 * @module billing/repository
 */

import {
  createServerClient,
  createServiceClient,
} from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import { logger } from "@/backend/platform/logger";

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

// ---------------------------------------------------------------------------
// F6-Ola1 additions
// ---------------------------------------------------------------------------

export type StripeCustomerRow = Tables<"stripe_customers">;
export type LedgerEntryRow = Tables<"ledger_entries">;

// ---------------------------------------------------------------------------
// Account statement DTO shapes (used by getAccountStatement)
// ---------------------------------------------------------------------------

export interface AccountStatementDto {
  plan: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    notes: string | null;
  } | null;
  installments: Array<{
    id: string;
    number: number;
    isDownpayment: boolean;
    amountCents: number;
    dueDate: string;
    status: "pending" | "processing" | "paid" | "overdue" | "waived";
    paidAt: string | null;
    payments: Array<{
      id: string;
      method: "stripe" | "zelle";
      status: string;
      amountCents: number;
      createdAt: string;
      confirmedAt: string | null;
    }>;
  }>;
  nextDue: {
    id: string;
    number: number;
    amountCents: number;
    dueDate: string;
    status: string;
  } | null;
  aggregates: {
    paidCents: number;
    pendingCents: number;
    overdueCents: number;
    waivedCents: number;
    totalCents: number;
  };
}

/**
 * Returns the full account statement for a case (plan + installments + payments + aggregates).
 * Uses service client — caller is responsible for authorization.
 */
export async function getAccountStatement(
  caseId: string,
): Promise<AccountStatementDto> {
  const supabase = createServiceClient();

  // Resolve plan via contracts.case_id
  const { data: planData } = await supabase
    .from("payment_plans")
    .select(`
      id, total_cents, downpayment_cents, installment_count, notes,
      contracts!inner(case_id),
      installments(
        id, number, is_downpayment, amount_cents, due_date, status, paid_at,
        payments(id, method, status, amount_cents, created_at, confirmed_at)
      )
    `)
    .eq("contracts.case_id", caseId)
    .maybeSingle();

  if (!planData) {
    return { plan: null, installments: [], nextDue: null, aggregates: { paidCents: 0, pendingCents: 0, overdueCents: 0, waivedCents: 0, totalCents: 0 } };
  }

  const raw = planData as unknown as {
    id: string;
    total_cents: number;
    downpayment_cents: number;
    installment_count: number;
    notes: string | null;
    installments: Array<{
      id: string;
      number: number;
      is_downpayment: boolean;
      amount_cents: number;
      due_date: string;
      status: string;
      paid_at: string | null;
      payments: Array<{
        id: string;
        method: string;
        status: string;
        amount_cents: number;
        created_at: string;
        confirmed_at: string | null;
      }>;
    }>;
  };

  // Sort installments by number
  const sortedInstallments = [...(raw.installments ?? [])].sort((a, b) => a.number - b.number);

  // Map to DTO
  const installments: AccountStatementDto["installments"] = sortedInstallments.map((inst) => ({
    id: inst.id,
    number: inst.number,
    isDownpayment: inst.is_downpayment,
    amountCents: inst.amount_cents,
    dueDate: inst.due_date,
    status: inst.status as AccountStatementDto["installments"][number]["status"],
    paidAt: inst.paid_at,
    payments: (inst.payments ?? []).map((p) => ({
      id: p.id,
      method: p.method as "stripe" | "zelle",
      status: p.status,
      amountCents: p.amount_cents,
      createdAt: p.created_at,
      confirmedAt: p.confirmed_at,
    })),
  }));

  // Compute aggregates
  let paidCents = 0;
  let pendingCents = 0;
  let overdueCents = 0;
  let waivedCents = 0;

  for (const inst of sortedInstallments) {
    if (inst.status === "paid") paidCents += inst.amount_cents;
    else if (inst.status === "overdue") overdueCents += inst.amount_cents;
    else if (inst.status === "waived") waivedCents += inst.amount_cents;
    else pendingCents += inst.amount_cents; // pending + processing
  }

  // Next due: first pending or overdue by due_date asc
  const nextDueInst = sortedInstallments
    .filter((i) => i.status === "pending" || i.status === "overdue")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;

  return {
    plan: {
      totalCents: raw.total_cents,
      downpaymentCents: raw.downpayment_cents,
      installmentCount: raw.installment_count,
      notes: raw.notes,
    },
    installments,
    nextDue: nextDueInst
      ? {
          id: nextDueInst.id,
          number: nextDueInst.number,
          amountCents: nextDueInst.amount_cents,
          dueDate: nextDueInst.due_date,
          status: nextDueInst.status,
        }
      : null,
    aggregates: {
      paidCents,
      pendingCents,
      overdueCents,
      waivedCents,
      totalCents: raw.total_cents,
    },
  };
}

/**
 * Returns the next due installment (first pending/overdue by due_date asc).
 */
export async function findNextDueInstallment(
  caseId: string,
): Promise<InstallmentRow | null> {
  const supabase = createServiceClient();

  // resolve via plan → contracts
  const { data: plan } = await supabase
    .from("payment_plans")
    .select("id, contracts!inner(case_id)")
    .eq("contracts.case_id", caseId)
    .maybeSingle();

  if (!plan) return null;

  const { data } = await supabase
    .from("installments")
    .select("*")
    .eq("payment_plan_id", plan.id)
    .in("status", ["pending", "overdue"])
    .order("due_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

/**
 * Returns an active Stripe payment (method=stripe, status=pending) for the installment.
 * Enforces the "active unique payment" rule (DOC-71 §1).
 */
export async function findActiveStripePayment(
  installmentId: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("installment_id", installmentId)
    .eq("method", "stripe")
    .eq("status", "pending")
    .maybeSingle();

  return data ?? null;
}

/**
 * Finds a payment by its Stripe Payment Intent ID.
 */
export async function findPaymentByIntentId(
  intentId: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("stripe_payment_intent_id", intentId)
    .maybeSingle();

  return data ?? null;
}

/**
 * Finds a payment by its Stripe Checkout Session ID.
 */
export async function findPaymentBySessionId(
  sessionId: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  return data ?? null;
}

/**
 * Finds an existing Stripe customer record for a user.
 */
export async function findStripeCustomer(
  userId: string,
): Promise<StripeCustomerRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("stripe_customers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return data ?? null;
}

/**
 * Upserts a stripe_customers row (creates if absent, updates if present).
 */
export async function upsertStripeCustomer(
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("stripe_customers")
    .upsert({ user_id: userId, stripe_customer_id: stripeCustomerId });

  if (error) {
    throw new Error(`billing.repository: upsertStripeCustomer failed — ${error.message}`);
  }
}

export interface InsertLedgerInput {
  paymentId: string;
  kind: "income" | "expense";
  category: string;
  amountCents: number;
  caseId: string;
  entryDate: string; // YYYY-MM-DD
  orgId: string;
}

/**
 * Inserts a ledger entry if no entry with the same (payment_id, kind) exists.
 *
 * Idempotent: a second call for the same (payment_id, kind) is a no-op.
 * DOC-44 §4 / RF-AND-029 — the DB has no unique constraint so we guard in code.
 */
export async function insertLedgerIfAbsent(
  input: InsertLedgerInput,
): Promise<void> {
  const supabase = createServiceClient();

  // Check for existing entry with same (payment_id, kind)
  const { data: existing } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("payment_id", input.paymentId)
    .eq("kind", input.kind)
    .maybeSingle();

  if (existing) {
    logger.info(
      { paymentId: input.paymentId, kind: input.kind },
      "billing.ledger: entry already exists — skipping (idempotent)",
    );
    return;
  }

  const { error } = await supabase.from("ledger_entries").insert({
    payment_id: input.paymentId,
    kind: input.kind,
    category: input.category,
    amount_cents: input.amountCents,
    case_id: input.caseId,
    entry_date: input.entryDate,
    org_id: input.orgId,
  });

  if (error) {
    // Tolerate race condition: if another insert won the race, this is effectively
    // a duplicate. Re-check before throwing.
    if ((error as { code?: string }).code === "23505") {
      logger.info(
        { paymentId: input.paymentId, kind: input.kind },
        "billing.ledger: concurrent insert detected — idempotent skip",
      );
      return;
    }
    throw new Error(`billing.repository: insertLedgerIfAbsent failed — ${error.message}`);
  }
}
