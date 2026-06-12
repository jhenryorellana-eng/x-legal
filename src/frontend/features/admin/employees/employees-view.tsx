"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DataTable,
  EmptyState,
  Modal,
  Switch,
  toast,
  type Column,
} from "@/frontend/components/desktop";
import { Avatar, GradientBtn, GhostBtn, Chip, StatusPill, Icon } from "@/frontend/components/brand";
import { ViewHead, FieldLabel, TextInput, RoleChip, inputStyle } from "../shared/chrome";
import { I18nField, type I18nValue } from "../shared/i18n-field";
import type { ModuleKey } from "@/shared/constants/modules";

/* ───────────────────────── Types ───────────────────────── */

export interface EmployeeVM {
  userId: string;
  email: string;
  isActive: boolean;
  displayName: string;
  role: string;
  title: string;
  avatarUrl: string | null;
  permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
  /** Has not yet set a password (invitation pending). */
  invitePending?: boolean;
}

export interface EmployeesMessages {
  t: Record<string, string>;
  moduleLabels: Record<string, string>;
}

type PermMap = Record<string, { view: boolean; edit: boolean }>;

export interface EmployeesViewProps {
  employees: EmployeeVM[];
  moduleKeys: readonly ModuleKey[];
  /** Default permission preset per role (for the create modal). */
  rolePresets: Record<string, PermMap>;
  messages: EmployeesMessages;
  actions: {
    invite: (input: {
      email: string;
      displayName: string;
      titleI18n: Record<string, string> | null;
      role: "sales" | "paralegal" | "finance";
      permissionsPreset: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
    }) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
    updatePermissions: (input: {
      staffId: string;
      permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
    }) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
    setActive: (
      staffId: string,
      active: boolean,
    ) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  };
}

/* ───────────────────────── View ───────────────────────── */

export function EmployeesView({
  employees,
  moduleKeys,
  rolePresets,
  messages,
  actions,
}: EmployeesViewProps) {
  const { t, moduleLabels } = messages;
  const router = useRouter();

  const [roleFilter, setRoleFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [matrixFor, setMatrixFor] = React.useState<EmployeeVM | null>(null);
  const [deactivateFor, setDeactivateFor] = React.useState<EmployeeVM | null>(null);

  const filtered = employees.filter((e) => {
    if (roleFilter !== "all" && e.role !== roleFilter) return false;
    if (statusFilter === "active" && !e.isActive) return false;
    if (statusFilter === "inactive" && e.isActive) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!e.displayName.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const roleLabel = (r: string) =>
    t[`role${r.charAt(0).toUpperCase()}${r.slice(1)}`] ?? r;

  const columns: Column<EmployeeVM>[] = [
    {
      id: "employee",
      header: t.colEmployee,
      cell: (e) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={e.displayName} variant="staff" src={e.avatarUrl ?? undefined} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>
              {e.displayName}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{e.title}</div>
          </div>
        </div>
      ),
    },
    { id: "email", header: t.colEmail, cell: (e) => <span style={{ fontSize: 13 }}>{e.email}</span> },
    {
      id: "role",
      header: t.colRole,
      cell: (e) => <RoleChip role={e.role} label={roleLabel(e.role)} />,
    },
    {
      id: "status",
      header: t.colStatus,
      cell: (e) =>
        e.invitePending ? (
          <Chip tone="amber" dot>
            {t.invitePending}
          </Chip>
        ) : (
          <StatusPill kind={e.isActive ? "aprobado" : "corregir"}>
            {e.isActive ? t.statusActive : t.statusInactive}
          </StatusPill>
        ),
    },
    {
      id: "permissions",
      header: t.colPermissions,
      cell: (e) => {
        const count = e.role === "admin" ? moduleKeys.length : e.permissions.filter((p) => p.can_view).length;
        return (
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {t.permSummary.replace("{n}", String(count))}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (e) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <RowBtn
            label={t.menuPermissions}
            icon="lock"
            onClick={(ev) => {
              ev.stopPropagation();
              setMatrixFor(e);
            }}
          />
          {e.isActive ? (
            <RowBtn
              label={t.menuDeactivate}
              icon="x"
              tone="var(--red)"
              onClick={(ev) => {
                ev.stopPropagation();
                setDeactivateFor(e);
              }}
            />
          ) : (
            <RowBtn
              label={t.menuReactivate}
              icon="check"
              tone="var(--green)"
              onClick={async (ev) => {
                ev.stopPropagation();
                const r = await actions.setActive(e.userId, true);
                if (r.ok) {
                  toast.success(t.statusActive);
                  router.refresh();
                } else toast.error(r.error?.message ?? "Error");
              }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1320 }}>
      <ViewHead title={t.title} sub={t.sub}>
        <GhostBtn size="md" full={false} icon="lock" onClick={() => employees[0] && setMatrixFor(employees.find((e) => e.role !== "admin") ?? employees[0])}>
          {t.permissionMatrix}
        </GhostBtn>
        <GradientBtn size="md" full={false} icon="plus" onClick={() => setCreateOpen(true)}>
          {t.newEmployee}
        </GradientBtn>
      </ViewHead>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={filterSelect}>
          <option value="all">{t.filterRole}: {t.colRole}</option>
          <option value="admin">{t.roleAdmin}</option>
          <option value="sales">{t.roleSales}</option>
          <option value="paralegal">{t.roleParalegal}</option>
          <option value="finance">{t.roleFinance}</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelect}>
          <option value="all">{t.filterStatus}</option>
          <option value="active">{t.statusActive}</option>
          <option value="inactive">{t.statusInactive}</option>
        </select>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Icon name="search" size={16} color="var(--ink-3)" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.filterSearch}
            style={{ ...inputStyle, paddingLeft: 36 }}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(e) => e.userId}
        empty={<EmptyState mood="calma" title={t.emptyTitle} subtitle={t.emptySub} />}
      />

      {createOpen && (
        <CreateEmployeeModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          moduleKeys={moduleKeys}
          moduleLabels={moduleLabels}
          rolePresets={rolePresets}
          t={t}
          onInvite={actions.invite}
          onDone={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}

      {matrixFor && (
        <PermissionMatrixModal
          employee={matrixFor}
          open={!!matrixFor}
          onClose={() => setMatrixFor(null)}
          moduleKeys={moduleKeys}
          moduleLabels={moduleLabels}
          rolePresets={rolePresets}
          t={t}
          onSave={actions.updatePermissions}
          allEmployees={employees}
          onDone={() => {
            setMatrixFor(null);
            router.refresh();
          }}
        />
      )}

      {deactivateFor && (
        <Modal
          open={!!deactivateFor}
          onOpenChange={(o) => !o && setDeactivateFor(null)}
          title={t.deactivateTitle}
          description={t.deactivateBody}
          tone="var(--red)"
          footer={
            <>
              <GhostBtn size="md" full={false} onClick={() => setDeactivateFor(null)}>
                {t.cancel}
              </GhostBtn>
              <GradientBtn
                size="md"
                full={false}
                c1="var(--red)"
                c2="var(--red)"
                onClick={async () => {
                  const r = await actions.setActive(deactivateFor.userId, false);
                  if (r.ok) {
                    toast.success(t.deactivateConfirm);
                    setDeactivateFor(null);
                    router.refresh();
                  } else toast.error(r.error?.message ?? "Error");
                }}
              >
                {t.deactivateConfirm}
              </GradientBtn>
            </>
          }
        >
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>
            {deactivateFor.displayName} · {deactivateFor.email}
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ───────────────────────── Create modal ───────────────────────── */

function CreateEmployeeModal({
  open,
  onClose,
  moduleKeys,
  moduleLabels,
  rolePresets,
  t,
  onInvite,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  moduleKeys: readonly ModuleKey[];
  moduleLabels: Record<string, string>;
  rolePresets: Record<string, PermMap>;
  t: Record<string, string>;
  onInvite: EmployeesViewProps["actions"]["invite"];
  onDone: () => void;
}) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState<I18nValue>({ es: "", en: "" });
  const [role, setRole] = React.useState<"sales" | "paralegal" | "finance">("sales");
  const [perms, setPerms] = React.useState<PermMap>(rolePresets.sales);
  const [saving, setSaving] = React.useState(false);
  const [emailErr, setEmailErr] = React.useState<string | null>(null);

  function selectRole(r: "sales" | "paralegal" | "finance") {
    setRole(r);
    setPerms(rolePresets[r]);
  }

  async function submit() {
    setSaving(true);
    setEmailErr(null);
    const permissionsPreset = moduleKeys.map((k) => ({
      module_key: k,
      can_view: perms[k]?.view ?? false,
      can_edit: perms[k]?.edit ?? false,
    }));
    const r = await onInvite({
      email,
      displayName: name,
      titleI18n: title.es || title.en ? { es: title.es ?? "", en: title.en ?? "" } : null,
      role,
      permissionsPreset,
    });
    setSaving(false);
    if (r.ok) {
      toast.success(t.inviteSent.replace("{email}", email));
      onDone();
    } else if (r.error?.code === "employee_already_exists") {
      setEmailErr(t.emailTaken);
      setStep(1);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  const presetNote: Record<string, string> = {
    sales: t.presetSales,
    paralegal: t.presetParalegal,
    finance: t.presetFinance,
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t.createTitle}
      width={step === 2 ? 640 : 520}
      footer={
        <>
          {step === 2 && (
            <GhostBtn size="md" full={false} onClick={() => setStep(1)}>
              {t.back}
            </GhostBtn>
          )}
          {step === 1 ? (
            <GradientBtn
              size="md"
              full={false}
              disabled={!email || !name}
              onClick={() => setStep(2)}
            >
              {t.next}
            </GradientBtn>
          ) : (
            <GradientBtn size="md" full={false} disabled={saving} icon="send" onClick={submit}>
              {t.createCta}
            </GradientBtn>
          )}
        </>
      }
    >
      {step === 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <FieldLabel>{t.fieldEmail}</FieldLabel>
            <TextInput
              type="email"
              value={email}
              invalid={!!emailErr}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailErr(null);
              }}
              placeholder="nombre@usalatinoprime.com"
            />
            {emailErr && (
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--red)" }}>{emailErr}</p>
            )}
          </div>
          <div>
            <FieldLabel>{t.fieldName}</FieldLabel>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <I18nField label={t.fieldTitle} value={title} onChange={setTitle} />
          <div>
            <FieldLabel>{t.fieldRole}</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {(["sales", "paralegal", "finance"] as const).map((r) => {
                const on = role === r;
                return (
                  <button
                    key={r}
                    onClick={() => selectRole(r)}
                    style={{
                      textAlign: "left",
                      padding: 12,
                      borderRadius: 14,
                      cursor: "pointer",
                      border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                      background: on ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
                    }}
                  >
                    <RoleChip role={r} label={t[`role${r.charAt(0).toUpperCase()}${r.slice(1)}`]} />
                    <p style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.4, color: "var(--ink-2)" }}>
                      {presetNote[r]}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <PermissionGrid
          perms={perms}
          setPerms={setPerms}
          moduleKeys={moduleKeys}
          moduleLabels={moduleLabels}
          t={t}
          disabled={false}
        />
      )}
    </Modal>
  );
}

/* ───────────────────────── Permission matrix modal ───────────────────────── */

function PermissionMatrixModal({
  employee,
  open,
  onClose,
  moduleKeys,
  moduleLabels,
  rolePresets,
  t,
  onSave,
  onDone,
  allEmployees,
}: {
  employee: EmployeeVM;
  open: boolean;
  onClose: () => void;
  moduleKeys: readonly ModuleKey[];
  moduleLabels: Record<string, string>;
  rolePresets: Record<string, PermMap>;
  t: Record<string, string>;
  onSave: EmployeesViewProps["actions"]["updatePermissions"];
  onDone: () => void;
  allEmployees: EmployeeVM[];
}) {
  const isAdmin = employee.role === "admin";

  const initial: PermMap = React.useMemo(() => {
    const m: PermMap = {};
    for (const k of moduleKeys) m[k] = { view: false, edit: false };
    for (const p of employee.permissions) {
      m[p.module_key] = { view: p.can_view, edit: p.can_edit };
    }
    return m;
  }, [employee, moduleKeys]);

  const [perms, setPerms] = React.useState<PermMap>(initial);
  const [saving, setSaving] = React.useState(false);

  const casesRevoked =
    !isAdmin &&
    (initial.cases?.view || initial.cases?.edit) &&
    !(perms.cases?.view || perms.cases?.edit);

  async function save() {
    setSaving(true);
    const permissions = moduleKeys.map((k) => ({
      module_key: k,
      can_view: perms[k]?.view ?? false,
      can_edit: perms[k]?.edit ?? false,
    }));
    const r = await onSave({ staffId: employee.userId, permissions });
    setSaving(false);
    if (r.ok) {
      toast.success(t.savedToast);
      onDone();
    } else toast.error(r.error?.message ?? "Error");
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`${t.tabPermissions} · ${employee.displayName}`}
      description={t.matrixHeader}
      width={620}
      footer={
        !isAdmin && (
          <>
            <GhostBtn
              size="md"
              full={false}
              onClick={() => {
                const empty: PermMap = {};
                for (const k of moduleKeys) empty[k] = { view: false, edit: false };
                setPerms(empty);
              }}
            >
              {t.removeAll}
            </GhostBtn>
            <GhostBtn size="md" full={false} onClick={() => setPerms(rolePresets[employee.role] ?? initial)}>
              {t.applyPreset}
            </GhostBtn>
            <GradientBtn size="md" full={false} disabled={saving} icon="check" onClick={save}>
              {t.save}
            </GradientBtn>
          </>
        )
      }
    >
      {isAdmin ? (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: "var(--gold-soft)",
            color: "var(--gold-deep)",
            fontSize: 13.5,
            fontWeight: 600,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Icon name="shield" size={18} color="var(--gold-deep)" />
          {t.adminRowNote}
        </div>
      ) : (
        <>
          {casesRevoked && (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 14px",
                borderRadius: 10,
                background: "var(--gold-soft)",
                color: "var(--gold-deep)",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {t.revokeCasesWarn}
            </div>
          )}
          <PermissionGrid
            perms={perms}
            setPerms={setPerms}
            moduleKeys={moduleKeys}
            moduleLabels={moduleLabels}
            t={t}
            disabled={false}
          />
          {allEmployees.length > 1 && null}
        </>
      )}
    </Modal>
  );
}

/* ───────────────────────── Permission grid (20 modules × view/edit) ───────────────────────── */

function PermissionGrid({
  perms,
  setPerms,
  moduleKeys,
  moduleLabels,
  t,
  disabled,
}: {
  perms: PermMap;
  setPerms: React.Dispatch<React.SetStateAction<PermMap>>;
  moduleKeys: readonly ModuleKey[];
  moduleLabels: Record<string, string>;
  t: Record<string, string>;
  disabled: boolean;
}) {
  function setCell(k: string, kind: "view" | "edit", value: boolean) {
    setPerms((prev) => {
      const cur = prev[k] ?? { view: false, edit: false };
      const next = { ...cur };
      if (kind === "edit") {
        next.edit = value;
        if (value) next.view = true; // edit forces view (RF-ADM-045 §2)
      } else {
        next.view = value;
        if (!value) next.edit = false; // turning off view turns off edit
      }
      return { ...prev, [k]: next };
    });
  }

  return (
    <div
      style={{
        maxHeight: 420,
        overflowY: "auto",
        border: "1px solid var(--line)",
        borderRadius: 12,
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={matrixHeadCell}>{t.colModule}</th>
            <th style={{ ...matrixHeadCell, textAlign: "center", width: 80 }}>{t.colView}</th>
            <th style={{ ...matrixHeadCell, textAlign: "center", width: 80 }}>{t.colEdit}</th>
          </tr>
        </thead>
        <tbody>
          {moduleKeys.map((k) => {
            const cell = perms[k] ?? { view: false, edit: false };
            return (
              <tr key={k}>
                <td style={matrixCell}>{moduleLabels[k] ?? k}</td>
                <td style={{ ...matrixCell, textAlign: "center" }}>
                  <Switch
                    checked={cell.view}
                    disabled={disabled}
                    aria-label={`${moduleLabels[k]} ${t.colView}`}
                    onCheckedChange={(v) => setCell(k, "view", v)}
                  />
                </td>
                <td style={{ ...matrixCell, textAlign: "center" }}>
                  <Switch
                    checked={cell.edit}
                    disabled={disabled}
                    aria-label={`${moduleLabels[k]} ${t.colEdit}`}
                    onCheckedChange={(v) => setCell(k, "edit", v)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────── small helpers ───────────────────────── */

function RowBtn({
  label,
  icon,
  tone = "var(--ink-2)",
  onClick,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  tone?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 32,
        height: 32,
        borderRadius: 9,
        border: "1px solid var(--line)",
        background: "var(--panel-2, var(--card-alt))",
        color: tone,
        cursor: "pointer",
      }}
    >
      <Icon name={icon} size={15} color={tone} />
    </button>
  );
}

const filterSelect: React.CSSProperties = {
  ...inputStyle,
  width: "auto",
  cursor: "pointer",
  minWidth: 140,
};

const matrixHeadCell: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "var(--panel-2, var(--card-alt))",
  textAlign: "left",
  padding: "9px 14px",
  fontFamily: "var(--font-title)",
  fontSize: 11.5,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--ink-3)",
  borderBottom: "1px solid var(--line)",
};

const matrixCell: React.CSSProperties = {
  padding: "9px 14px",
  fontSize: 13.5,
  color: "var(--ink)",
  borderBottom: "1px solid var(--line-2, var(--line))",
};
