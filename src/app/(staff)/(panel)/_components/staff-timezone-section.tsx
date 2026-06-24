/**
 * StaffTimezoneSection — the shared "Zona horaria" card for every staff
 * Configuración (DOC-23 §6.5). Reads the actor's location server-side and wires
 * the shared TimezoneLocationCard with the identity actions. Each staff member
 * (Vanessa=Colombia, Henry=US, …) sees the agenda/availability in their own zone.
 *
 * App-layer component (allowed to import module-pub + frontend), embedded by the
 * per-role configuración pages below their existing view.
 */

import { getTranslations } from "next-intl/server";
import { getActor, getCurrentUserLocation } from "@/backend/modules/identity";
import {
  setUserTimezoneAction,
  setUserLocationAction,
} from "@/backend/modules/identity/actions";
import { TimezoneLocationCard } from "@/frontend/components/settings/timezone-location-card";

export async function StaffTimezoneSection({ locale }: { locale: "es" | "en" }) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") return null;
  const loc = await getCurrentUserLocation(actor);
  const t = await getTranslations("staff.config");

  return (
    <div style={{ maxWidth: 760, margin: "16px 0 32px" }}>
      <TimezoneLocationCard
        initialTimezone={loc.timezone}
        initialCity={loc.city}
        initialCountry={loc.country}
        locale={locale}
        setTimezone={setUserTimezoneAction}
        setLocation={setUserLocationAction}
        labels={{
          title: t("tzTitle"),
          subtitle: t("tzSub"),
          detect: t("tzDetect"),
          detecting: t("tzDetecting"),
          locationLabel: t("tzLocation"),
          detectUnavailable: t("tzUnavailable"),
        }}
      />
    </div>
  );
}
