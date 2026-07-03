"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { DemoAssetActions } from "./demo-data-modal";

/**
 * DemoCardMenu — the "⋯" menu on a /admin/demo card. The card itself stays a
 * plain <Link>; this small client island sits absolutely on top of it. The Data
 * modal is code-split and only mounted after the first click, so the index
 * page stays light.
 */

const DemoDataModal = dynamic(
  () => import("./demo-data-modal").then((m) => m.DemoDataModal),
  { ssr: false },
);

export function DemoCardMenu({
  slug,
  assetActions,
}: {
  slug: string;
  assetActions: DemoAssetActions;
}) {
  const t = useTranslations("staff.demo.assets");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalMounted, setModalMounted] = React.useState(false);

  const openData = () => {
    setModalMounted(true);
    setModalOpen(true);
  };

  return (
    <>
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={t("menuAria")}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 2,
              display: "inline-grid",
              placeItems: "center",
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink-2)",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1,
              cursor: "pointer",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            ⋯
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            // Portals to <body>, outside the staff shell scope (same reason as
            // desktop/modal.tsx).
            className="surface-staff"
            align="end"
            sideOffset={6}
            style={{
              zIndex: 62,
              minWidth: 160,
              // `.surface-staff` carries `min-height: 100dvh` (full-page staff
              // surface); on a portaled dropdown that stretches the menu to the
              // viewport height. Reset it so the menu sizes to its items (same
              // fix as desktop/modal.tsx).
              minHeight: 0,
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
            }}
          >
            <DropdownMenuPrimitive.Item
              onSelect={openData}
              style={{
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 700,
                color: "var(--ink)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {t("menuData")}
            </DropdownMenuPrimitive.Item>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>

      {modalMounted && (
        <DemoDataModal
          slug={slug}
          open={modalOpen}
          onOpenChange={setModalOpen}
          actions={assetActions}
        />
      )}
    </>
  );
}
