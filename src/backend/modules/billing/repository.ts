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
 * Lists orphaned Stripe payment attempts: pending/stripe rows inserted before the
 * Checkout Session was created (session_id IS NULL) and older than the cutoff.
 * These block new checkouts via payments_active_stripe_unique_idx until cleared.
 * (Sessions that WERE created and then expire are handled by the
 * checkout.session.expired webhook, so they are intentionally excluded here.)
 */
export async function listOrphanStripePayments(
  olderThanIso: string,
): Promise<PaymentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("method", "stripe")
    .eq("status", "pending")
    .is("stripe_checkout_session_id", null)
    .lt("created_at", olderThanIso);

  if (error) {
    throw new Error(
      `billing.repository: listOrphanStripePayments failed — ${error.message}`,
    );
  }
  return data ?? [];
}

/**
 * Lists Stripe payments awaiting reconciliation: pending/stripe rows whose Checkout
 * Session WAS created (session_id IS NOT NULL) but never confirmed, older than the
 * cutoff. The reconcile-stripe-payments cron retrieves each session from Stripe and
 * settles it (paid) or fails it (expired). This is the safety net for when the
 * webhook never arrives AND the client closed the tab before the return-URL
 * reconcile ran — complementary to listOrphanStripePayments (session_id IS NULL).
 */
export async function listPendingStripeSessionsToReconcile(
  olderThanIso: string,
): Promise<PaymentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("method", "stripe")
    .eq("status", "pending")
    .not("stripe_checkout_session_id", "is", null)
    .lt("created_at", olderThanIso);

  if (error) {
    throw new Error(
      `billing.repository: listPendingStripeSessionsToReconcile failed — ${error.message}`,
    );
  }
  return data ?? [];
}

/**
 * Returns the orphaned Stripe payment for a single installment (session_id IS NULL
 * and older than the cutoff), if any. Used by the lazy cleanup inside
 * createCheckoutSessionForInstallment so a client can retry without waiting for cron.
 */
export async function findOrphanStripePaymentForInstallment(
  installmentId: string,
  olderThanIso: string,
): Promise<PaymentRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("installment_id", installmentId)
    .eq("method", "stripe")
    .eq("status", "pending")
    .is("stripe_checkout_session_id", null)
    .lt("created_at", olderThanIso)
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

// ---------------------------------------------------------------------------
// F6-Ola2: Collection queries (markOverdues, reminders, calendar, metrics)
// ---------------------------------------------------------------------------

/** Minimal row for overdue universe processing (cron). */
export interface OverdueUniverseRow {
  id: string;
  caseId: string;
  orgId: string;
  number: number;
  amountCents: number;
  dueDate: string;
}

/**
 * Lists pending installments with due_date < today, excluding cancelled cases.
 * Used by markOverdues cron. Index: (status, due_date).
 */
export async function listOverdueUniverse(today: string): Promise<OverdueUniverseRow[]> {
  const supabase = createServiceClient();

  // installments → payment_plans → contracts → cases (join for org_id + status filter)
  const { data, error } = await supabase
    .from("installments")
    .select(`
      id, number, amount_cents, due_date,
      payment_plans!inner(
        contracts!inner(
          case_id,
          cases!inner(status, org_id)
        )
      )
    `)
    .eq("status", "pending")
    .lt("due_date", today);

  if (error) throw new Error(`billing.repository: listOverdueUniverse — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    number: number;
    amount_cents: number;
    due_date: string;
    payment_plans: {
      contracts: {
        case_id: string;
        cases: { status: string; org_id: string };
      };
    };
  }>;

  return rows
    .filter((r) => r.payment_plans.contracts.cases.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      number: r.number,
      amountCents: r.amount_cents,
      dueDate: r.due_date,
      caseId: r.payment_plans.contracts.case_id,
      orgId: r.payment_plans.contracts.cases.org_id,
    }));
}

/** Minimal row for reminder dispatching. */
export interface ReminderTargetRow {
  installmentId: string;
  caseId: string;
  clientUserId: string | null;
  dueDate: string;
  number: number;
}

/**
 * Returns pending installments with due_date in {today, today+3} that haven't
 * been reminded recently (last_reminder_at IS NULL or < today-1).
 */
export async function listReminderTargets(today: string): Promise<ReminderTargetRow[]> {
  const supabase = createServiceClient();

  // Build date range: today and today+3
  const todayDate = new Date(today);
  const plus3 = new Date(todayDate);
  plus3.setDate(plus3.getDate() + 3);
  const plus3Str = plus3.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("installments")
    .select(`
      id, due_date, number, last_reminder_at,
      payment_plans!inner(
        contracts!inner(
          case_id,
          cases!inner(status)
        )
      )
    `)
    .eq("status", "pending")
    .in("due_date", [today, plus3Str])
    .or("last_reminder_at.is.null,last_reminder_at.lt." + today);

  if (error) throw new Error(`billing.repository: listReminderTargets — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    due_date: string;
    number: number;
    last_reminder_at: string | null;
    payment_plans: {
      contracts: {
        case_id: string;
        cases: { status: string };
      };
    };
  }>;

  // Exclude cancelled cases
  const validRows = rows.filter(
    (r) => r.payment_plans.contracts.cases.status !== "cancelled",
  );

  // Fetch client user IDs via case_members
  const caseIds = [...new Set(validRows.map((r) => r.payment_plans.contracts.case_id))];
  const clientMap = new Map<string, string | null>();

  if (caseIds.length > 0) {
    const { data: members } = await supabase
      .from("case_members")
      // LOW fix: deterministic client selection — first joined by created_at ASC
      .select("case_id, user_id, users!inner(kind, is_active)")
      .in("case_id", caseIds)
      .order("created_at", { ascending: true });

    const memberRows = (members ?? []) as unknown as Array<{
      case_id: string;
      user_id: string;
      users: { kind: string; is_active: boolean };
    }>;

    for (const m of memberRows) {
      if (m.users.kind === "client" && m.users.is_active && !clientMap.has(m.case_id)) {
        clientMap.set(m.case_id, m.user_id);
      }
    }
  }

  return validRows.map((r) => ({
    installmentId: r.id,
    caseId: r.payment_plans.contracts.case_id,
    clientUserId: clientMap.get(r.payment_plans.contracts.case_id) ?? null,
    dueDate: r.due_date,
    number: r.number,
  }));
}

/** Shape returned by listDueCalendar. */
export interface DueCalendarItemRepo {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  installmentCount: number;
  amountCents: number;
  status: string;
  isDownpayment: boolean;
  dueDate: string;
}

/**
 * Lists installments in a due-date range with case/client info.
 * RF-AND-014 / DOC-44 §4.
 */
export async function listDueCalendar(
  orgId: string,
  input: { from: string; to: string; status?: string; serviceId?: string },
): Promise<DueCalendarItemRepo[]> {
  const supabase = createServiceClient();

  // BLOCKER-1 fix: push org filter into the DB query via !inner join.
  // The JS .filter() below is defense-in-depth — the query already scopes to the org.
  let query = supabase
    .from("installments")
    .select(`
      id, number, amount_cents, due_date, status, is_downpayment,
      payment_plans!inner(
        installment_count,
        contracts!inner(
          case_id,
          cases!inner(
            id, case_number, org_id, status,
            case_members(
              user_id,
              users!inner(kind, is_active, client_profiles(first_name, last_name))
            )
          )
        )
      )
    `)
    .eq("payment_plans.contracts.cases.org_id", orgId)
    .gte("due_date", input.from)
    .lte("due_date", input.to)
    .order("due_date", { ascending: true });

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`billing.repository: listDueCalendar — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    number: number;
    amount_cents: number;
    due_date: string;
    status: string;
    is_downpayment: boolean;
    payment_plans: {
      installment_count: number;
      contracts: {
        case_id: string;
        cases: {
          id: string;
          case_number: string;
          org_id: string;
          case_members: Array<{
            user_id: string;
            users: {
              kind: string;
              is_active: boolean;
              client_profiles:
                | { first_name: string; last_name: string }
                | Array<{ first_name: string; last_name: string }>
                | null;
            };
          }>;
        };
      };
    };
  }>;

  // JS filter as defense-in-depth (DB .eq filter above is authoritative)
  const orgFiltered = rows.filter((r) => r.payment_plans.contracts.cases.org_id === orgId);

  // TODO(Ola-3): serviceId filter requires a service join in the select above.
  // For now, serviceId is accepted but not applied — caller should note this.
  // Do NOT implement as `.filter(() => !input.serviceId || true)` (always-true no-op).
  if (input.serviceId) {
    logger.warn({ serviceId: input.serviceId }, "billing.repository: listDueCalendar — serviceId filter not yet implemented (TODO Ola-3)");
  }

  return orgFiltered
    .map((r) => {
      const kase = r.payment_plans.contracts.cases;
      // Resolve client display name
      const clientMember = (kase.case_members ?? [])
        .filter((m) => m.users.is_active && m.users.kind === "client")[0];
      const cpRaw = clientMember?.users?.client_profiles;
      const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw;
      const clientName = cp
        ? `${cp.first_name} ${cp.last_name}`.trim()
        : clientMember?.user_id ?? "—";

      return {
        installmentId: r.id,
        caseId: r.payment_plans.contracts.case_id,
        caseNumber: kase.case_number,
        clientName,
        number: r.number,
        installmentCount: r.payment_plans.installment_count,
        amountCents: r.amount_cents,
        status: r.status,
        isDownpayment: r.is_downpayment,
        dueDate: r.due_date,
      };
    });
}

/** Shape returned by listOverdueForCollections. */
export interface OverdueItemRepo {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  amountCents: number;
  dueDate: string;
  daysLateVal: number;
}

/**
 * Lists all overdue installments for an org ordered by due_date ASC.
 * RF-AND-020 / DOC-44 §4.
 */
export async function listOverdueForCollections(
  orgId: string,
): Promise<OverdueItemRepo[]> {
  const supabase = createServiceClient();

  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("installments")
    .select(`
      id, number, amount_cents, due_date,
      payment_plans!inner(
        contracts!inner(
          case_id,
          cases!inner(
            id, case_number, org_id,
            case_members(
              user_id,
              users!inner(kind, is_active, client_profiles(first_name, last_name))
            )
          )
        )
      )
    `)
    .eq("status", "overdue")
    .order("due_date", { ascending: true });

  if (error) throw new Error(`billing.repository: listOverdueForCollections — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    number: number;
    amount_cents: number;
    due_date: string;
    payment_plans: {
      contracts: {
        case_id: string;
        cases: {
          id: string;
          case_number: string;
          org_id: string;
          case_members: Array<{
            user_id: string;
            users: {
              kind: string;
              is_active: boolean;
              client_profiles:
                | { first_name: string; last_name: string }
                | Array<{ first_name: string; last_name: string }>
                | null;
            };
          }>;
        };
      };
    };
  }>;

  return rows
    .filter((r) => r.payment_plans.contracts.cases.org_id === orgId)
    .map((r) => {
      const kase = r.payment_plans.contracts.cases;
      const clientMember = (kase.case_members ?? [])
        .filter((m) => m.users.is_active && m.users.kind === "client")[0];
      const cpRaw = clientMember?.users?.client_profiles;
      const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw;
      const clientName = cp
        ? `${cp.first_name} ${cp.last_name}`.trim()
        : clientMember?.user_id ?? "—";

      const dueDateObj = new Date(r.due_date);
      const todayObj = new Date(today);
      const diffMs = todayObj.getTime() - dueDateObj.getTime();
      const daysLateVal = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      return {
        installmentId: r.id,
        caseId: r.payment_plans.contracts.case_id,
        caseNumber: kase.case_number,
        clientName,
        number: r.number,
        amountCents: r.amount_cents,
        dueDate: r.due_date,
        daysLateVal,
      };
    });
}

/** Aggregated collection metrics for the Andrium dashboard (DOC-44 §3.12). */
export interface CollectionMetricsRepo {
  collectedMonthCents: number;
  onTimePct: number;
  overdue: { cuotas: number; montoCents: number; casos: number };
}

/**
 * Computes collection metrics for an org.
 * RF-AND-044 / DOC-44 §3.12.
 */
export async function collectionMetrics(
  orgId: string,
  today: string,  // YYYY-MM-DD
  month: string,  // YYYY-MM
): Promise<CollectionMetricsRepo> {
  const supabase = createServiceClient();

  // 1. Collected this month = Σ ledger_entries income in month
  const monthStart = `${month}-01`;
  const monthEndDate = new Date(parseInt(month.split("-")[0]), parseInt(month.split("-")[1]), 0);
  const monthEnd = monthEndDate.toISOString().split("T")[0];

  const { data: ledgerData } = await supabase
    .from("ledger_entries")
    .select("amount_cents")
    .eq("org_id", orgId)
    .eq("kind", "income")
    .gte("entry_date", monthStart)
    .lte("entry_date", monthEnd);

  const collectedMonthCents = (ledgerData ?? []).reduce(
    (sum, r) => sum + (r.amount_cents as number),
    0,
  );

  // 2. On-time %: installments with due_date <= today and status != 'waived'
  // BLOCKER-1 fix: push org filter into the DB query via !inner join path.
  // The JS .filter() below is a safety net; the query already scopes to the org.
  const { data: exigiblesData } = await supabase
    .from("installments")
    .select(`
      id, status,
      payment_plans!inner(
        contracts!inner(
          cases!inner(org_id)
        )
      )
    `)
    .eq("payment_plans.contracts.cases.org_id", orgId)
    .lte("due_date", today)
    .neq("status", "waived");

  const exigiblesRaw = (exigiblesData ?? []) as unknown as Array<{
    id: string;
    status: string;
    payment_plans: { contracts: { cases: { org_id: string } } };
  }>;

  // JS filter as defense-in-depth (PostgREST !inner join filter is authoritative above)
  const exigibles = exigiblesRaw.filter(
    (r) => r.payment_plans.contracts.cases.org_id === orgId,
  );
  const alDia = exigibles.filter((r) => r.status === "paid");
  const onTimePct = exigibles.length === 0
    ? 100
    : Math.round((alDia.length / exigibles.length) * 100);

  // 3. Overdue: count, sum, distinct cases
  // BLOCKER-1 fix: push org filter into the DB query.
  const { data: overdueData } = await supabase
    .from("installments")
    .select(`
      id, amount_cents,
      payment_plans!inner(
        contracts!inner(
          case_id,
          cases!inner(org_id)
        )
      )
    `)
    .eq("payment_plans.contracts.cases.org_id", orgId)
    .eq("status", "overdue");

  const overdueRaw = (overdueData ?? []) as unknown as Array<{
    id: string;
    amount_cents: number;
    payment_plans: { contracts: { case_id: string; cases: { org_id: string } } };
  }>;

  // JS filter as defense-in-depth
  const overdueFiltered = overdueRaw.filter(
    (r) => r.payment_plans.contracts.cases.org_id === orgId,
  );

  const overdueCuotas = overdueFiltered.length;
  const overdueMonto = overdueFiltered.reduce((s, r) => s + r.amount_cents, 0);
  const overdueCasos = new Set(
    overdueFiltered.map((r) => r.payment_plans.contracts.case_id),
  ).size;

  return {
    collectedMonthCents,
    onTimePct,
    overdue: { cuotas: overdueCuotas, montoCents: overdueMonto, casos: overdueCasos },
  };
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

// ---------------------------------------------------------------------------
// F6-Ola3: Contabilidad — manual ledger entries, libro, monthly summary
// ---------------------------------------------------------------------------

export interface ManualLedgerInput {
  orgId: string;
  kind: "income" | "expense";
  category: string;
  amountCents: number;
  entryDate: string; // YYYY-MM-DD
  description: string | null;
  caseId: string | null;
  recordedBy: string;
}

/** Inserts a manual ledger entry (payment_id = null, recorded_by = staff). */
export async function insertLedgerEntry(
  input: ManualLedgerInput,
): Promise<LedgerEntryRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      category: input.category,
      amount_cents: input.amountCents,
      entry_date: input.entryDate,
      description: input.description,
      case_id: input.caseId,
      recorded_by: input.recordedBy,
      payment_id: null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`billing.repository: insertLedgerEntry failed — ${error?.message}`);
  }
  return data;
}

export async function findLedgerEntryById(
  entryId: string,
): Promise<LedgerEntryRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ledger_entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();
  return data ?? null;
}

/** Updates a manual ledger entry. Caller enforces the editable (manual) guard. */
export async function updateLedgerEntryRow(
  entryId: string,
  patch: TablesUpdate<"ledger_entries">,
): Promise<LedgerEntryRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .update(patch)
    .eq("id", entryId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`billing.repository: updateLedgerEntryRow failed — ${error?.message}`);
  }
  return data;
}

export interface LedgerListFilters {
  from?: string;
  to?: string;
  kind?: "income" | "expense";
  category?: string;
  caseId?: string;
  cursor?: string; // opaque: `${entry_date}|${id}`
  limit?: number;
}

export interface LedgerItemRepo {
  id: string;
  entryDate: string;
  kind: "income" | "expense";
  category: string;
  amountCents: number;
  description: string | null;
  caseId: string | null;
  caseNumber: string | null;
  isAutomatic: boolean; // payment_id != null → auto, candado
  recordedBy: string | null;
  createdAt: string;
}

function encodeLedgerCursor(entryDate: string, id: string): string {
  return Buffer.from(`${entryDate}|${id}`, "utf8").toString("base64");
}

function decodeLedgerCursor(cursor: string): { entryDate: string; id: string } | null {
  try {
    const [entryDate, id] = Buffer.from(cursor, "base64").toString("utf8").split("|");
    if (!entryDate || !id) return null;
    return { entryDate, id };
  } catch {
    return null;
  }
}

/**
 * Lists ledger entries for an org with keyset pagination.
 * Ordered by (entry_date DESC, id DESC). org_id on the row is authoritative.
 * RF-AND-028 / API-BIL-15.
 */
export async function listLedger(
  orgId: string,
  filters: LedgerListFilters,
): Promise<{ items: LedgerItemRepo[]; nextCursor: string | null }> {
  const supabase = createServiceClient();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);

  let query = supabase
    .from("ledger_entries")
    .select(`
      id, entry_date, kind, category, amount_cents, description,
      case_id, payment_id, recorded_by, created_at,
      cases(case_number)
    `)
    .eq("org_id", orgId);

  if (filters.from) query = query.gte("entry_date", filters.from);
  if (filters.to) query = query.lte("entry_date", filters.to);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.caseId) query = query.eq("case_id", filters.caseId);

  if (filters.cursor) {
    const c = decodeLedgerCursor(filters.cursor);
    if (c) {
      // (entry_date, id) < (cursor.entryDate, cursor.id) in DESC order
      query = query.or(
        `entry_date.lt.${c.entryDate},and(entry_date.eq.${c.entryDate},id.lt.${c.id})`,
      );
    }
  }

  query = query
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;
  if (error) throw new Error(`billing.repository: listLedger — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    entry_date: string;
    kind: "income" | "expense";
    category: string;
    amount_cents: number;
    description: string | null;
    case_id: string | null;
    payment_id: string | null;
    recorded_by: string | null;
    created_at: string;
    cases: { case_number: string } | Array<{ case_number: string }> | null;
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items: LedgerItemRepo[] = page.map((r) => {
    const caseRaw = r.cases;
    const kase = Array.isArray(caseRaw) ? caseRaw[0] : caseRaw;
    return {
      id: r.id,
      entryDate: r.entry_date,
      kind: r.kind,
      category: r.category,
      amountCents: r.amount_cents,
      description: r.description,
      caseId: r.case_id,
      caseNumber: kase?.case_number ?? null,
      isAutomatic: r.payment_id !== null,
      recordedBy: r.recorded_by,
      createdAt: r.created_at,
    };
  });

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeLedgerCursor(last.entry_date, last.id) : null;

  return { items, nextCursor };
}

export interface MonthlyLedgerSummaryRepo {
  incomeCents: number;
  expenseCents: number;
  byCategory: Array<{ kind: "income" | "expense"; category: string; totalCents: number }>;
}

/**
 * Aggregates ledger income/expense + per-category totals for a date range.
 * Pure aggregation of the libro (RF-AND-032). org_id is authoritative.
 */
export async function monthlyLedgerSummary(
  orgId: string,
  range: { start: string; end: string },
): Promise<MonthlyLedgerSummaryRepo> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("kind, category, amount_cents")
    .eq("org_id", orgId)
    .gte("entry_date", range.start)
    .lte("entry_date", range.end);

  if (error) throw new Error(`billing.repository: monthlyLedgerSummary — ${error.message}`);

  let incomeCents = 0;
  let expenseCents = 0;
  const catMap = new Map<string, { kind: "income" | "expense"; category: string; totalCents: number }>();

  for (const r of (data ?? []) as Array<{ kind: "income" | "expense"; category: string; amount_cents: number }>) {
    if (r.kind === "income") incomeCents += r.amount_cents;
    else expenseCents += r.amount_cents;

    const key = `${r.kind}:${r.category}`;
    const existing = catMap.get(key);
    if (existing) existing.totalCents += r.amount_cents;
    else catMap.set(key, { kind: r.kind, category: r.category, totalCents: r.amount_cents });
  }

  const byCategory = [...catMap.values()].sort((a, b) => b.totalCents - a.totalCents);

  return { incomeCents, expenseCents, byCategory };
}

/** Resolves the active client user_id of a case (first by created_at). */
export async function findCaseClientUserId(caseId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_members")
    .select("user_id, users!inner(kind, is_active)")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    users: { kind: string; is_active: boolean };
  }>;

  for (const m of rows) {
    if (m.users.kind === "client" && m.users.is_active) return m.user_id;
  }
  return null;
}
