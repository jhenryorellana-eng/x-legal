"use client";

/**
 * Gestionar categorías — full CRUD for lead categories (DOC-11 RF-VAN-014 A2,
 * propuesta P-02). Rename, recolor, reorder, (de)activate and delete. Loads the
 * org's categories on open (incl. inactive) and mutates via the ventas actions.
 * Replaces the previous fake "+ Crear" category row with a real catalog editor.
 */

import * as React from "react";
import { MSym } from "../shared/msym";
import { useToast } from "../shared/toast-bridge";
import { Modal } from "@/frontend/components/desktop";
import { CATEGORY_COLOR_TOKENS, categoryColorHex } from "./category-colors";

export interface CategoryItem {
  id: string;
  label: string;
  color: string;
  position: number;
  isActive: boolean;
}

export interface CategoryManagerStrings {
  title: string;
  sub: string;
  empty: string;
  namePh: string;
  add: string;
  save: string;
  cancel: string;
  close: string;
  delete: string;
  deleteConfirm: string; // "¿Eliminar «{label}»?"
  deactivatedToast: string;
  deletedToast: string;
  hide: string;
  show: string;
  moveUp: string;
  moveDown: string;
  errorGeneric: string;
}

export interface CategoryManagerActions {
  list: () => Promise<{ ok: boolean; categories?: CategoryItem[]; error?: { code: string } }>;
  create: (input: { label: string; color: string }) => Promise<{ ok: boolean; id?: string }>;
  update: (input: {
    categoryId: string;
    label?: string;
    color?: string;
    isActive?: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  remove: (input: { categoryId: string }) => Promise<{ ok: boolean; softDeleted?: boolean; error?: { code: string } }>;
  reorder: (input: { orderedIds: string[] }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strings: CategoryManagerStrings;
  actions: CategoryManagerActions;
  /** Called after any mutation so the parent can refresh chips/cards. */
  onChanged?: () => void;
}

export function CategoryManager({ open, onOpenChange, strings, actions, onChanged }: CategoryManagerProps) {
  const toast = useToast();
  const [items, setItems] = React.useState<CategoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [newLabel, setNewLabel] = React.useState("");
  const [newColor, setNewColor] = React.useState<string>(CATEGORY_COLOR_TOKENS[0]);
  const [busy, setBusy] = React.useState(false);
  // Label at focus time, per id — so saveLabel compares against the value the
  // user STARTED editing, not the live (already-mutated) state snapshot.
  const labelAtFocus = React.useRef<Record<string, string>>({});

  // `actions` is rebuilt inline by the parent on every render; pin it to a ref so
  // refresh()/effects stay stable and don't re-fire on unrelated parent renders.
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const res = await actionsRef.current.list();
    setLoading(false);
    if (res.ok && res.categories) {
      setItems([...res.categories].sort((a, b) => a.position - b.position));
    }
  }, []);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const fail = () => {
    toast.error(strings.errorGeneric);
    void refresh();
  };

  const setLabel = (id: string, label: string) =>
    setItems((cur) => cur.map((c) => (c.id === id ? { ...c, label } : c)));

  const saveLabel = async (item: CategoryItem, original: string) => {
    const label = item.label.trim();
    if (!label || label === original) {
      if (!label) setLabel(item.id, original);
      return;
    }
    const res = await actions.update({ categoryId: item.id, label });
    if (res.ok) onChanged?.();
    else fail();
  };

  const cycleColor = async (item: CategoryItem) => {
    const idx = CATEGORY_COLOR_TOKENS.indexOf(item.color as (typeof CATEGORY_COLOR_TOKENS)[number]);
    const next = CATEGORY_COLOR_TOKENS[(idx + 1) % CATEGORY_COLOR_TOKENS.length];
    setItems((cur) => cur.map((c) => (c.id === item.id ? { ...c, color: next } : c)));
    const res = await actions.update({ categoryId: item.id, color: next });
    if (res.ok) onChanged?.();
    else fail();
  };

  const toggleActive = async (item: CategoryItem) => {
    const isActive = !item.isActive;
    setItems((cur) => cur.map((c) => (c.id === item.id ? { ...c, isActive } : c)));
    const res = await actions.update({ categoryId: item.id, isActive });
    if (res.ok) onChanged?.();
    else fail();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setItems(reordered);
    const res = await actions.reorder({ orderedIds: reordered.map((c) => c.id) });
    if (res.ok) onChanged?.();
    else fail();
  };

  const confirmDelete = async (item: CategoryItem) => {
    const res = await actions.remove({ categoryId: item.id });
    setDeletingId(null);
    if (res.ok) {
      toast.success(res.softDeleted ? strings.deactivatedToast : strings.deletedToast);
      onChanged?.();
      void refresh();
    } else {
      fail();
    }
  };

  const addCategory = async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    const res = await actions.create({ label, color: newColor });
    setBusy(false);
    if (res.ok) {
      setNewLabel("");
      setNewColor(CATEGORY_COLOR_TOKENS[0]);
      onChanged?.();
      void refresh();
    } else {
      fail();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={strings.title}
      description={strings.sub}
      width={520}
      footer={
        <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => onOpenChange(false)}>
          {strings.close}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!loading && items.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 700, padding: "8px 2px" }}>
            {strings.empty}
          </div>
        )}

        {items.map((item, index) => {
          const hex = categoryColorHex(item.color);
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 11,
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                opacity: item.isActive ? 1 : 0.55,
              }}
            >
              <button
                type="button"
                aria-label="color"
                title={item.color}
                onClick={() => void cycleColor(item)}
                style={{
                  width: 22,
                  height: 22,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  background: hex,
                  border: "2px solid #fff",
                  boxShadow: "0 0 0 1px var(--line)",
                  cursor: "pointer",
                }}
              />
              <input
                value={item.label}
                onChange={(e) => setLabel(item.id, e.target.value)}
                onFocus={() => { labelAtFocus.current[item.id] = item.label; }}
                onBlur={() => void saveLabel(item, labelAtFocus.current[item.id] ?? item.label)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  type="button"
                  className="kcol-menu"
                  aria-label={strings.moveUp}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <MSym name="keyboard_arrow_up" size={18} />
                </button>
                <button
                  type="button"
                  className="kcol-menu"
                  aria-label={strings.moveDown}
                  disabled={index === items.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <MSym name="keyboard_arrow_down" size={18} />
                </button>
                <button
                  type="button"
                  className="kcol-menu"
                  aria-label={item.isActive ? strings.hide : strings.show}
                  title={item.isActive ? strings.hide : strings.show}
                  onClick={() => void toggleActive(item)}
                >
                  <MSym name={item.isActive ? "visibility" : "visibility_off"} size={18} />
                </button>
                {deletingId === item.id ? (
                  <>
                    <button
                      type="button"
                      className="vbtn vbtn-sm"
                      style={{ background: "var(--brand-red)", color: "#fff" }}
                      onClick={() => void confirmDelete(item)}
                    >
                      {strings.delete}
                    </button>
                    <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setDeletingId(null)}>
                      {strings.cancel}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="kcol-menu"
                    aria-label={strings.delete}
                    onClick={() => setDeletingId(item.id)}
                  >
                    <MSym name="delete" size={18} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add new */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            paddingTop: 12,
            borderTop: "1px solid var(--line)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            {CATEGORY_COLOR_TOKENS.map((tok) => (
              <button
                key={tok}
                type="button"
                aria-label={tok}
                onClick={() => setNewColor(tok)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: categoryColorHex(tok),
                  border: newColor === tok ? "2px solid var(--ink)" : "2px solid transparent",
                  boxShadow: newColor === tok ? "0 0 0 2px #fff inset" : undefined,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={strings.namePh}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addCategory();
              }
            }}
            style={{ flex: "1 1 140px", minWidth: 120 }}
          />
          <button
            type="button"
            className="vbtn vbtn-primary vbtn-sm"
            disabled={!newLabel.trim() || busy}
            onClick={() => void addCategory()}
          >
            <MSym name="add" size={16} />
            {strings.add}
          </button>
        </div>
      </div>
    </Modal>
  );
}
