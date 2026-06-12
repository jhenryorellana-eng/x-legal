/**
 * Mock data for the dev-only admin preview harness (Playwright evidence).
 *
 * This module is imported ONLY by the (dev)/admin-preview route, which itself
 * 404s when NODE_ENV === "production". None of this data reaches production.
 */

import { MODULE_KEYS } from "@/shared/constants/modules";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";
import type { EmployeeVM, EmployeesMessages } from "@/frontend/features/admin/employees/employees-view";
import type { ServiceCardVM } from "@/frontend/features/admin/catalog/catalog-list-view";
import type { AuditRow } from "@/frontend/features/admin/audit/audit-client";
import type { OrgConfigVM, CoverTemplateVM, TermsVersionVM } from "@/frontend/features/admin/config/config-view";

export const moduleLabels: Record<string, string> = {
  dashboard: "Dashboard", leads: "Leads", clients: "Clientes", cases: "Casos",
  calendar: "Calendario", availability: "Disponibilidad", metrics: "Métricas",
  catalog: "Catálogo", datasets: "Datasets IA", employees: "Empleados", billing: "Pagos",
  collections: "Cobranza", printing: "Impresión", campaigns: "Campañas", accounting: "Contabilidad",
  expedientes: "Expedientes", validations: "Validaciones", messaging: "Mensajería",
  community: "Comunidad", audit: "Auditoría",
};

export const employeesMock: EmployeeVM[] = [
  {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "vanessa@usalatinoprime.com",
    isActive: true,
    displayName: "Vanessa Morales",
    role: "sales",
    title: "Asesora de ventas",
    avatarUrl: null,
    permissions: ROLE_PRESETS.sales
      ? Object.entries(ROLE_PRESETS.sales).map(([k, v]) => ({ module_key: k, can_view: v.view, can_edit: v.edit }))
      : [],
  },
  {
    userId: "22222222-2222-2222-2222-222222222222",
    email: "diana@usalatinoprime.com",
    isActive: true,
    displayName: "Diana Gutiérrez",
    role: "paralegal",
    title: "Paralegal",
    avatarUrl: null,
    permissions: Object.entries(ROLE_PRESETS.paralegal).map(([k, v]) => ({ module_key: k, can_view: v.view, can_edit: v.edit })),
  },
  {
    userId: "33333333-3333-3333-3333-333333333333",
    email: "andrium@usalatinoprime.com",
    isActive: true,
    displayName: "Andrium Rojas",
    role: "finance",
    title: "Coordinador de finanzas",
    avatarUrl: null,
    permissions: Object.entries(ROLE_PRESETS.finance).map(([k, v]) => ({ module_key: k, can_view: v.view, can_edit: v.edit })),
  },
  {
    userId: "44444444-4444-4444-4444-444444444444",
    email: "karla@usalatinoprime.com",
    isActive: true,
    displayName: "Karla Mendoza",
    role: "paralegal",
    title: "Paralegal",
    avatarUrl: null,
    permissions: Object.entries(ROLE_PRESETS.paralegal).map(([k, v]) => ({ module_key: k, can_view: v.view, can_edit: v.edit })),
    invitePending: true,
  },
  {
    userId: "55555555-5555-5555-5555-555555555555",
    email: "henry@usalatinoprime.com",
    isActive: true,
    displayName: "Henry Orellana",
    role: "admin",
    title: "Dueño",
    avatarUrl: null,
    permissions: MODULE_KEYS.map((k) => ({ module_key: k, can_view: true, can_edit: true })),
  },
];

export const employeesMessages: EmployeesMessages = {
  t: {
    title: "Empleados", sub: "Tu equipo y lo que cada quien puede ver y hacer.",
    newEmployee: "Nuevo empleado", permissionMatrix: "Matriz de permisos",
    filterRole: "Rol", filterStatus: "Estado", filterSearch: "Buscar por nombre o email…",
    colEmployee: "Empleado", colEmail: "Email", colRole: "Rol", colStatus: "Estado",
    colLastSeen: "Última conexión", colPermissions: "Permisos",
    roleAdmin: "Admin", roleSales: "Ventas", roleParalegal: "Paralegal", roleFinance: "Finanzas",
    statusActive: "Activo", statusInactive: "Inactivo", invitePending: "Invitación pendiente",
    permSummary: "{n} de 20 módulos", menuEdit: "Editar", menuPermissions: "Permisos",
    menuResend: "Reenviar invitación", menuDeactivate: "Desactivar", menuReactivate: "Reactivar",
    emptyTitle: "Aún no hay empleados", emptySub: "Crea tu primer empleado e invítalo al panel.",
    createTitle: "Nuevo empleado", stepProfile: "Perfil", stepPermissions: "Permisos iniciales",
    fieldEmail: "Email", fieldName: "Nombre", fieldTitle: "Título", fieldRole: "Rol",
    emailTaken: "Ya existe un empleado con este email.",
    presetSales: "Acceso a leads, calendario, clientes y métricas de ventas.",
    presetParalegal: "Acceso a casos, expedientes, validaciones y calendario.",
    presetFinance: "Acceso a pagos, cobranza, contabilidad e impresión.",
    createCta: "Crear y enviar invitación", inviteSent: "Invitación enviada a {email}.",
    tabProfile: "Perfil", tabPermissions: "Permisos", tabSecurity: "Seguridad",
    matrixHeader: "Los roles son un punto de partida, no un límite: puedes dar a cualquier empleado cualquier módulo.",
    colModule: "Módulo", colView: "Ver", colEdit: "Editar", applyPreset: "Aplicar preset del rol",
    copyFrom: "Copiar permisos de…", removeAll: "Quitar todo",
    adminRowNote: "Los administradores tienen acceso total; la matriz no les aplica.",
    savedToast: "Permisos actualizados.", revokeCasesWarn: "Sus casos asignados quedarán inaccesibles.",
    deactivateTitle: "Desactivar empleado", deactivateBody: "El acceso se corta de inmediato; el historial se conserva.",
    deactivateConfirm: "Desactivar", reactivateTitle: "Reactivar empleado", reactivateBody: "—",
    securityCloseSessions: "Cerrar todas sus sesiones", securityRemoveTotp: "Retirar TOTP",
    cancel: "Cancelar", save: "Guardar", next: "Siguiente", back: "Atrás",
  },
  moduleLabels,
};

export const catalogMessages: Record<string, string> = {
  title: "Catálogo de servicios",
  sub: "Lo que tu negocio vende, como configuración — nunca como código.",
  newService: "Nuevo servicio", filterSearch: "Buscar por slug o nombre…",
  filterCategory: "Categoría", filterStatus: "Estado", showArchived: "Mostrar archivados",
  catMigratorio: "Migratorio", catEmpresarial: "Empresarial", catFamiliar: "Familiar",
  statusDraft: "Borrador", statusActive: "Activo", statusHidden: "Oculto del cliente",
  statusArchived: "Archivado", phases: "{n} fases", planSelf: "Self", planLawyer: "Con abogado",
  entryBadge: "Entrada → {parent} · {phase}", menuEdit: "Editar", menuClone: "Clonar",
  menuActivate: "Activar", menuDeactivate: "Desactivar", menuHide: "Ocultar al cliente",
  menuShow: "Mostrar al cliente", menuArchive: "Archivar", menuRestore: "Restaurar",
  menuHistory: "Ver historial", emptyTitle: "Tu catálogo está vacío",
  emptySub: "Crea tu primer servicio y véndelo hoy mismo — sin programadores.",
  archiveConfirmTitle: "Archivar servicio",
  archiveConfirmBody: "El servicio dejará de ser contratable y se ocultará del editor. Los casos en curso no se afectan.",
  cancel: "Cancelar", save: "Guardar", next: "Siguiente", back: "Atrás",
  saved: "Guardado hace un momento", missingEn: "Falta EN", delete: "Eliminar", backToList: "Volver al catálogo",
  bannerProd: "Estás editando un servicio en producción: los cambios de textos se reflejan de inmediato en la app del cliente.",
  step1: "Datos básicos", step2: "Planes", step3: "Fases", step4: "Documentos", step5: "Formularios", step6: "Publicar",
  slug: "Identificador (slug)", slugLocked: "El identificador no puede cambiar: ya existen casos de este servicio.",
  category: "Categoría", labelField: "Nombre del servicio", descShort: "Descripción corta", descLong: "¿Qué es?",
  appearance: "Apariencia", icon: "Icono", color: "Color", isPublic: "Visible en el catálogo del cliente",
  previewMobile: "Vista previa móvil", offerPlan: "Ofrecer este plan", price: "Precio", installments: "Cuotas por defecto",
  downpayment: "Cuota inicial", lawyerIncluded: "Incluye validación con abogado",
  lawyerNote: "Activa automáticamente el flujo de validación legal en los casos que lo contraten.",
  priceNote: "Cambiar el precio no afecta contratos ya firmados.", addPhase: "Agregar fase",
  phaseLabel: "Nombre de la fase", clientExplainer: "Explicación para el cliente", apptPolicy: "Política de citas",
  apptCount: "Citas", apptDuration: "Duración (min)", apptKind: "Tipo", apptVideo: "Videollamada", apptPhone: "Teléfono",
  apptPresencial: "Presencial", apptNote: "Es el default para casos nuevos; cada caso puede tener su ajuste propio.",
  selectPhase: "Fase", docDocument: "Documento", docCategory: "Categoría", docRequired: "Obligatorio",
  docPerParty: "Por parte", docAiExtract: "IA extrae", formStub: "Disponible en F4",
  formStubSub: "El editor de formularios (PDF oficial y Generación IA) llega en la fase F4.",
  publishTitle: "Lista de comprobación de publicación", publishReady: "Todo listo para publicar.",
  activateService: "Activar servicio",
  celebrate: "🎉 {service} ya está a la venta. El cliente lo ve en su app y Vanessa puede crear contratos — sin deploy.",
  issueBlocking: "Bloqueante", issueWarning: "Advertencia",
};

export const servicesMock: ServiceCardVM[] = [
  { id: "s1", slug: "asilo-politico", category: "migratorio", label: "Asilo Político", icon: "scale", color: "navy", isActive: true, isPublic: true, archived: false, isEntry: false, planKinds: ["self", "with_lawyer"], phaseCount: 5 },
  { id: "s2", slug: "visa-juvenil", category: "migratorio", label: "Visa Juvenil", icon: "family", color: "accent", isActive: true, isPublic: true, archived: false, isEntry: false, planKinds: ["self"], phaseCount: 4 },
  { id: "s3", slug: "reforzar-asilo", category: "migratorio", label: "Reforzar Asilo", icon: "shield", color: "gold", isActive: true, isPublic: true, archived: false, isEntry: true, entryParentLabel: "Asilo Político", planKinds: ["with_lawyer"], phaseCount: 3 },
  { id: "s4", slug: "llc-florida", category: "empresarial", label: "Creación de LLC en Florida", icon: "briefcase", color: "green", isActive: false, isPublic: false, archived: false, isEntry: false, planKinds: [], phaseCount: 2 },
];

export const auditMessages: Record<string, string> = {
  title: "Auditoría", sub: "Registro inmutable de todas las acciones del equipo.",
  readOnly: "Solo lectura", filterActor: "Actor", filterEntity: "Tipo de entidad",
  filterAction: "Acción", filterFrom: "Desde", filterTo: "Hasta", exportCsv: "Exportar CSV",
  colWhen: "Cuándo", colWho: "Quién", colAction: "Acción", colEntity: "Entidad", colIp: "IP",
  systemActor: "Sistema", detailTitle: "Detalle del cambio", diffField: "Campo",
  diffBefore: "Valor anterior", diffAfter: "Valor nuevo", noDiff: "Esta acción no modifica campos.",
  encryptedNote: "Los campos cifrados nunca se muestran en claro.", viewRawJson: "Ver JSON crudo",
  viewEntityHistory: "Ver historial completo de esta entidad",
  emptyTitle: "Toda acción del equipo quedará registrada aquí",
  emptySub: "Cuando alguien cree, edite o publique algo, aparecerá en esta bitácora.",
  emptyFiltered: "Ninguna entrada coincide con estos filtros.", loadMore: "Cargar más",
};

export const auditRowsMock: AuditRow[] = [
  {
    id: "a1", created_at: "2026-06-12T13:41:00Z", actor_user_id: "55555555-5555-5555-5555-555555555555",
    action: "catalog.service.updated", entity_type: "services", entity_id: "asilo-politico", ip: "187.45.210.3",
    diff: { before: { label_i18n: { es: "Asilo", en: "Asylum" }, price_cents: 520000 }, after: { label_i18n: { es: "Asilo Político", en: "Political Asylum" }, price_cents: 550000 } },
  },
  {
    id: "a2", created_at: "2026-06-12T13:05:00Z", actor_user_id: "55555555-5555-5555-5555-555555555555",
    action: "catalog.form_version.published", entity_type: "form_automation_versions", entity_id: "i360-v3", ip: "187.45.210.3", diff: {},
  },
  {
    id: "a3", created_at: "2026-06-11T20:18:00Z", actor_user_id: "11111111-1111-1111-1111-111111111111",
    action: "billing.zelle.confirmed", entity_type: "payments", entity_id: "ULP-2026-0061", ip: "64.20.118.42", diff: {},
  },
  {
    id: "a4", created_at: "2026-06-11T18:02:00Z", actor_user_id: null,
    action: "integrations.validation.verdict_received", entity_type: "cases", entity_id: "ULP-2026-0042", ip: null, diff: {},
  },
  {
    id: "a5", created_at: "2026-06-10T15:30:00Z", actor_user_id: "55555555-5555-5555-5555-555555555555",
    action: "update_permissions", entity_type: "staff", entity_id: "22222222-2222-2222-2222-222222222222", ip: "187.45.210.3",
    diff: { before: { cases: { view: true, edit: false } }, after: { cases: { view: true, edit: true } } },
  },
];

export const auditActorsMock = [
  { id: "55555555-5555-5555-5555-555555555555", name: "Henry Orellana", avatar: null },
  { id: "11111111-1111-1111-1111-111111111111", name: "Vanessa Morales", avatar: null },
  { id: "22222222-2222-2222-2222-222222222222", name: "Diana Gutiérrez", avatar: null },
];

export const configMessages: Record<string, string> = {
  title: "Configuración", sub: "Los datos de tu organización, en un solo lugar.",
  tabGeneral: "General", tabCovers: "Carátulas", tabTerms: "Términos y condiciones",
  orgName: "Nombre de la organización", logo: "Logo", contactPhones: "Teléfonos de contacto",
  phoneLabel: "Etiqueta (oficina)", phoneNumber: "Número", addPhone: "Añadir teléfono",
  timezone: "Zona horaria por defecto", invalidPhone: "El número no es válido.",
  generalNote: "Estos valores alimentan el footer de la app, las plantillas de email y las pantallas de contacto — nada queda hardcodeado.",
  coversEmptyTitle: "Aún no hay plantillas de carátula", coversEmptySub: "Las plantillas de carátula se crean en el editor (próximamente).",
  coverActive: "Activa", coverInactive: "Inactiva", coverInactiveNote: "Las inactivas no se ofrecen en el ensamblador.",
  coverEditNote: "Editar una plantilla no altera carátulas ya generadas.",
  termsCurrent: "Versión vigente", termsCurrentChip: "Vigente", termsHistory: "Historial de versiones",
  termsNewVersion: "Nueva versión", termsVersionId: "Identificador de versión", termsTitle: "Título",
  termsBody: "Contenido", termsPublish: "Publicar y marcar como vigente", termsPublished: "Publicada el {date}",
  termsCompliance: "Cumplimiento", termsAcceptedBy: "{n} aceptaciones",
  termsImmutable: "Las versiones aceptadas son inmutables: se crea una versión nueva.",
  termsEmptyTitle: "Sin versiones de T&C todavía", termsEmptySub: "Crea la primera versión de tus términos y condiciones.",
  save: "Guardar", cancel: "Cancelar", delete: "Eliminar", saved: "Guardado hace un momento",
};

export const orgMock: OrgConfigVM = {
  id: "org1",
  name: "UsaLatinoPrime LLC",
  settings: {
    contact_phones: [
      { label: "Oficina Florida", phone: "+1 (305) 555-0142" },
      { label: "Oficina Utah", phone: "+1 (801) 555-0177" },
    ],
    default_timezone: "America/New_York",
    logo_url: null,
    goals: {},
  },
};

export const coversMock: CoverTemplateVM[] = [
  { id: "c1", name: "Carátula EOIR clásica", is_active: true },
  { id: "c2", name: "Carátula USCIS azul", is_active: false },
  { id: "c3", name: "Carátula corte estatal", is_active: true },
];

export const termsMock: TermsVersionVM[] = [
  { id: "t1", version: "v2026-03", title: "Términos y condiciones", is_active: true, published_at: "2026-03-14T00:00:00Z" },
  { id: "t2", version: "v2025-11", title: "Términos y condiciones", is_active: false, published_at: "2025-11-01T00:00:00Z" },
  { id: "t3", version: "v2025-04", title: "Términos y condiciones", is_active: false, published_at: "2025-04-01T00:00:00Z" },
];

export const acceptancesMock: Record<string, number> = { "v2026-03": 2, "v2025-11": 14, "v2025-04": 31 };

export const timezonesMock = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Mexico_City", "America/Bogota", "America/Lima",
];

/** No-op server-action shaped stubs (preview is read-only). */
export const noopSuccess = async () => ({ success: true as const });
export const noopOk = async () => ({ ok: true as const });
