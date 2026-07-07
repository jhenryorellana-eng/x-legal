import type { DemoScenario } from "./types";

/**
 * Visa Juvenil (SIJS) — escenario demo de "Mateo" (menor ficticio) y su tutora
 * "María". Es el flujo multi-fase del sistema: Custodia estatal → I-360 (USCIS)
 * → I-485 (ajuste de estatus). Cada fase trae sus propios documentos, formularios
 * y su generación IA (petición de custodia con hallazgos SIJS, I-360, paquete
 * I-485). El expediente es el archivo compilado FINAL que cruza las tres fases.
 *
 * Base legal: 8 U.S.C. §1101(a)(27)(J). Contenido tomado del guion demo y los
 * playbooks de la v1 + la SoT (DOC-32 §5, DOC-40). Todo es inventado: ningún
 * dato real, ningún PII. Solo para el demo — no existe como servicio en la BD.
 */
export const visaJuvenil: DemoScenario = {
  slug: "visa-juvenil",
  service: { label: "Visa Juvenil (SIJS)", icon: "family", color: "purple" },
  client: {
    firstName: "María",
    parties: [{ name: "Mateo", role: "applicant" }],
  },
  caseTitle: "Visa Juvenil (SIJS) — Mateo",
  phaseLabel: "Fase 1 de 3 · Custodia",

  contract: {
    planLabel: "Visa Juvenil (SIJS) · Con abogado",
    nextAmount: "$600",
    installments: [
      { label: "Cuota inicial", amount: "$600", due: "Hoy", isDownPayment: true },
      { label: "Cuota 2", amount: "$350", due: "5 ago" },
      { label: "Cuota 3", amount: "$350", due: "5 sep" },
      { label: "Cuota 4", amount: "$350", due: "5 oct" },
      { label: "Cuota 5", amount: "$350", due: "5 nov" },
      { label: "Cuota 6", amount: "$350", due: "5 dic" },
      { label: "Cuota 7", amount: "$350", due: "5 ene" },
      { label: "Cuota 8", amount: "$350", due: "5 feb" },
      { label: "Cuota 9", amount: "$350", due: "5 mar" },
      { label: "Cuota 10", amount: "$350", due: "5 abr" },
    ],
    clauses: [
      {
        title: "1. Objeto del servicio",
        body: "UsaLatinoPrime acompañará al menor y a su tutora en el proceso de Estatus Especial de Inmigrante Juvenil (SIJS, 8 U.S.C. §1101(a)(27)(J)) en sus tres fases: (1) la orden de custodia con hallazgos SIJS ante la corte estatal, (2) la petición I-360 ante USCIS y (3) el ajuste de estatus I-485 a Residente Permanente Legal.",
      },
      {
        title: "2. Requisitos del menor",
        body: "El proceso exige que el menor sea soltero y menor de 21 años, y que la corte estatal emita la orden con los hallazgos SIJS antes de que cumpla la edad límite de su estado. El cliente se compromete a demostrar que la reunificación con uno o ambos padres no es viable por abuso, abandono o negligencia.",
      },
      {
        title: "3. Honorarios y tarifas oficiales",
        body: "El cliente acepta el plan de pagos detallado: una cuota inicial y nueve cuotas mensuales. Las tarifas oficiales de USCIS (I-360 y I-485) y de la corte estatal no están incluidas en estos honorarios.",
      },
      {
        title: "4. Alcance y confidencialidad",
        body: "El cliente entregará información verídica y completa. Ninguna parte garantiza un resultado específico: las decisiones corresponden a la corte estatal y a USCIS. La disponibilidad de visa puede generar esperas según el país de nacimiento. Toda la información se trata de forma estrictamente confidencial.",
      },
    ],
  },

  captions: {
    cases:
      "Así ve María el caso de Mateo recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma el contrato en segundos, directo desde el teléfono.",
    pagos: "Paga la cuota inicial de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
  },

  phases: [
    {
      slug: "custodia",
      label: "Custodia",
      color: "purple",

      documents: [
        {
          id: "acta-menor",
          label: "Acta de nacimiento del menor",
          hint: "Apostillada si está disponible.",
          category: "Identidad del menor",
          extract: [
            { field: "Menor", value: "Mateo Alejandro Rivas Cordero" },
            { field: "Fecha de nacimiento", value: "18/05/2012" },
            { field: "Edad", value: "14 años" },
            { field: "Lugar de nacimiento", value: "San Pedro Sula, Honduras" },
            { field: "Madre", value: "María Cordero Lanza" },
          ],
        },
        {
          id: "id-menor",
          label: "Pasaporte / identificación del menor",
          hint: "Página de datos, nítida y completa.",
          category: "Identidad del menor",
          extract: [
            { field: "Documento", value: "Pasaporte hondureño" },
            { field: "Titular", value: "Mateo Alejandro Rivas Cordero" },
            { field: "N.º de pasaporte", value: "H-2088173" },
            { field: "Vencimiento", value: "03/2028" },
          ],
        },
        {
          id: "id-tutor",
          label: "Identificación de la tutora",
          hint: "ID con foto de quien ejerce la custodia.",
          category: "Tutela",
          extract: [
            { field: "Tutora", value: "María Cordero Lanza" },
            { field: "Vínculo", value: "Madre del menor" },
            { field: "Documento", value: "Licencia de Florida" },
            { field: "Domicilio", value: "Hialeah, FL" },
          ],
        },
        {
          id: "evidencia-abuso",
          label: "Evidencias de abuso, abandono o negligencia",
          hint: "Reportes, denuncias o constancias que sustenten el caso.",
          category: "Sustento SIJS",
          extract: [
            { field: "Hecho", value: "Abandono del padre desde 2016" },
            { field: "Constancia", value: "Reporte de trabajo social escolar" },
            { field: "Terapia", value: "Registros de apoyo psicológico" },
            { field: "Relación con el caso", value: "Reunificación con el padre no viable" },
          ],
        },
        {
          id: "comprobante-domicilio",
          label: "Comprobante de domicilio de la tutora",
          hint: "Recibo o contrato a nombre de la tutora.",
          category: "Tutela",
          extract: [
            { field: "Titular", value: "María Cordero Lanza" },
            { field: "Dirección", value: "760 W 29th St, Apt 3" },
            { field: "Ciudad / Estado", value: "Hialeah, FL 33012" },
            { field: "Emitido", value: "Mayo 2026" },
          ],
        },
        {
          id: "registros-escolares",
          label: "Registros escolares del menor",
          hint: "Constancia de matrícula y desempeño.",
          category: "Sustento SIJS",
          extract: [
            { field: "Escuela", value: "Hialeah Middle School" },
            { field: "Grado", value: "8.º grado" },
            { field: "Matriculado desde", value: "2024" },
            { field: "Uso", value: "Mejor interés del menor en EE. UU." },
          ],
        },
      ],

      forms: [
        {
          id: "mi-historia",
          label: "Mi Historia — declaración del menor",
          kind: "letter",
          progress: 100,
          caption: "El relato del menor que sustenta los hallazgos SIJS",
          sections: [
            {
              title: "Quién soy",
              items: [
                { q: "Nombre", a: "Mateo Alejandro Rivas Cordero" },
                { q: "Edad", a: "14 años" },
                { q: "¿Con quién vives?", a: "Con mi mamá, María, en Hialeah, Florida." },
              ],
            },
            {
              title: "Mi papá",
              items: [
                { q: "¿Dónde está tu papá?", a: "Se fue cuando yo tenía 4 años; no volvió a comunicarse." },
                { q: "¿Te ha apoyado?", a: "No; nunca dio manutención ni cuidado." },
                { q: "¿Es posible reunirte con él?", a: "No; me abandonó y no es seguro ni posible." },
              ],
            },
            {
              title: "Mi vida ahora",
              items: [
                { q: "¿Cómo estás en la escuela?", a: "Voy a Hialeah Middle School y me esfuerzo mucho." },
                { q: "¿Qué es mejor para ti?", a: "Quedarme con mi mamá en un lugar seguro." },
              ],
            },
            {
              title: "Declaración",
              items: [
                { q: "¿Es verídico tu relato?", a: "Sí, lo declaro bajo pena de perjurio." },
              ],
            },
          ],
        },
        {
          id: "custodia-estatal",
          label: "Formulario de custodia estatal (SAPCR)",
          kind: "pdf",
          progress: 100,
          caption: "Petición de custodia ante la corte estatal de familia",
          sections: [
            {
              title: "Datos del menor",
              items: [
                { q: "Nombre completo", a: "Mateo Alejandro Rivas Cordero" },
                { q: "Fecha de nacimiento", a: "18 de mayo de 2012" },
                { q: "Estado civil", a: "Soltero" },
              ],
            },
            {
              title: "Datos de la tutora",
              items: [
                { q: "Nombre completo", a: "María Cordero Lanza" },
                { q: "Vínculo", a: "Madre" },
                { q: "Domicilio", a: "Hialeah, FL 33012" },
              ],
            },
            {
              title: "Hallazgos solicitados (SIJS)",
              items: [
                { q: "Dependencia del menor", a: "Bajo la custodia de la madre por orden de la corte." },
                { q: "Reunificación parental", a: "No viable con el padre por abandono." },
                { q: "Mejor interés", a: "No es en el mejor interés del menor regresar a Honduras." },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "María sube los documentos del menor y las pruebas del abandono. El sistema sabe exactamente qué pedir.",
        formularios:
          "La historia de Mateo y la petición de custodia estatal ya están completas, listas para revisar.",
        review:
          "Cada respuesta organizada por el sistema para la corte de familia. Solo revisar y enviar.",
      },

      automation: {
        slotKey: "custodia-form",
        title: "Formulario de custodia estatal",
        officialTitle:
          "Petición de custodia (SAPCR) con hallazgos SIJS · Corte de Familia del Condado de Miami-Dade",
        intro: "El sistema llena la petición de custodia de la corte estatal a partir de los datos del menor y de la tutora.",
        loaderTitle: "Ensamblando la petición de custodia",
        sourcePanelLabel: "Formulario de María",
        targetPanelLabel: "Petición SAPCR · Corte estatal",
        filledChipLabel: "8 campos vacíos → N/A",
        fillNote: "La corte estatal debe emitir la orden con los hallazgos SIJS antes de la edad límite del estado; 8 campos sin dato se completaron con “N/A”.",
        previewTitle: "Petición de custodia — PDF oficial",
        doneMeta: "6 págs · PDF de la corte · 8 campos en N/A",
        docKicker: "Formulario oficial · Corte estatal",
        docPageTitle: "Petición de custodia (SAPCR) — hallazgos SIJS",
        downloadName: "custodia-sijs.pdf",
        splash: {
          title: "¡Petición de custodia generada!",
          body: "El formulario de la corte estatal quedó completo, listo para presentar.",
        },
        steps: [
          { icon: "form", text: "Leyendo los datos del menor y la tutora…" },
          { icon: "doc", text: "Abriendo el formulario de custodia de la corte…" },
          { icon: "scale", text: "Insertando los hallazgos SIJS solicitados…" },
          { icon: "bolt", text: "Mapeando cada dato a su campo oficial…" },
          { icon: "check", text: "Generando el PDF final…" },
        ],
        fields: [
          { plain: "Nombre del menor", official: "Child — Full Legal Name", fieldName: "ChildName", value: "Rivas Cordero, Mateo Alejandro" },
          { plain: "Fecha de nacimiento", official: "Child — Date of Birth", fieldName: "ChildDOB", value: "05/18/2012" },
          { plain: "Estado civil del menor", official: "Child — Marital Status", fieldName: "ChildMaritalStatus", value: "Single" },
          { plain: "Nombre de la tutora", official: "Petitioner — Full Legal Name", fieldName: "PetitionerName", value: "Cordero Lanza, María" },
          { plain: "Vínculo con el menor", official: "Petitioner — Relationship", fieldName: "Relationship", value: "Mother" },
          { plain: "Domicilio", official: "Petitioner — Address", fieldName: "PetitionerAddress", value: "760 W 29th St, Apt 3, Hialeah, FL 33012" },
          { plain: "Reunificación parental", official: "SIJ Finding — Reunification", fieldName: "ReunificationNotViable", value: "Not viable with father (abandonment)" },
          { plain: "Mejor interés", official: "SIJ Finding — Best Interest", fieldName: "BestInterest", value: "Not in the child's best interest to return to Honduras" },
          { plain: "Firma del abogado", official: "Attorney Signature", fieldName: "AttorneySignature", value: null },
        ],
      },

      generation: {
        slotKey: "custodia-peticion",
        title: "Petición de custodia con hallazgos SIJS",
        caption: "Escrito legal ante la corte de familia — sustento de los hallazgos especiales.",
        intro: "La IA redacta la petición de custodia con los hallazgos especiales SIJS a partir de la historia del menor y las evidencias del expediente.",
        loaderTitle: "Generando la petición de custodia SIJS",
        previewTitle: "Petición de custodia con hallazgos SIJS",
        snippet:
          "Se solicita a esta Honorable Corte de Familia declarar que el menor depende de la corte, que su reunificación con el padre no es viable por abandono, y que no es en su mejor interés regresar a Honduras (8 U.S.C. §1101(a)(27)(J)).",
        longSummary:
          "El menor, Mateo Alejandro Rivas Cordero, de 14 años, reside con su madre en Hialeah, Florida, tras el abandono de su padre desde 2016. La presente petición solicita a la Corte de Familia los hallazgos especiales SIJS: que el menor queda bajo la custodia de su madre por orden de la corte, que su reunificación con el padre no es viable por abandono, y que no es en su mejor interés regresar a Honduras. Estos hallazgos, conforme a 8 U.S.C. §1101(a)(27)(J), son el predicado indispensable de la petición I-360 ante USCIS.",
        indexTitle: "Índice de la petición",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "3,120 palabras · 14 páginas · listo",
        downloadName: "peticion-custodia-sijs.pdf",
        splash: {
          title: "¡Petición de custodia generada!",
          body: "La petición con hallazgos SIJS está lista para revisión legal.",
        },
        stats: [
          { value: "3,120", label: "palabras" },
          { value: "14", label: "páginas" },
          { value: "5", label: "hallazgos SIJS" },
          { value: "4", label: "fuentes verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 3120 },
          { label: "páginas", value: 14 },
          { label: "hallazgos SIJS", value: 5 },
        ],
        steps: [
          { icon: "doc", text: "Extrayendo la historia del menor…" },
          { icon: "search", text: "Revisando las evidencias de abandono…" },
          { icon: "scale", text: "Redactando los hallazgos especiales SIJS…" },
          { icon: "shield", text: "Verificando la base legal (8 U.S.C. §1101(a)(27)(J))…" },
          { icon: "sparkle", text: "Ensamblando la petición final…" },
        ],
        sections: [
          "I. Jurisdicción de la corte de familia",
          "II. Hechos: abandono paterno y custodia materna",
          "III. Dependencia del menor de la corte",
          "IV. No viabilidad de la reunificación parental",
          "V. Mejor interés del menor",
          "VI. Petición de hallazgos SIJS",
        ],
      },
    },

    {
      slug: "i360",
      label: "I-360",
      color: "accent",

      documents: [
        {
          id: "orden-custodia",
          label: "Orden de custodia con hallazgos SIJS (predicate order)",
          hint: "La orden firmada por la corte estatal — la base del I-360.",
          category: "Predicate order",
          extract: [
            { field: "Corte", value: "Corte de Familia — Miami-Dade, FL" },
            { field: "Menor", value: "Mateo Alejandro Rivas Cordero" },
            { field: "Hallazgos", value: "Dependencia, reunificación no viable, mejor interés" },
            { field: "Fecha de la orden", value: "12/06/2026" },
          ],
        },
        {
          id: "i94-menor",
          label: "I-94 del menor",
          hint: "Registro de entrada/salida de EE. UU.",
          category: "Migratorio",
          extract: [
            { field: "Titular", value: "Mateo Alejandro Rivas Cordero" },
            { field: "N.º de admisión I-94", value: "774120583A1" },
            { field: "Fecha de entrada", value: "14/03/2023" },
            { field: "Clase de admisión", value: "Menor no acompañado (ORR)" },
          ],
        },
        {
          id: "fotos-uscis",
          label: "Fotos tipo pasaporte (USCIS)",
          hint: "Dos fotos 2x2 recientes del menor.",
          category: "USCIS",
          extract: [
            { field: "Formato", value: "2x2 pulgadas, fondo blanco" },
            { field: "Cantidad", value: "2 fotos" },
            { field: "Tomadas", value: "Junio 2026" },
          ],
        },
        {
          id: "acta-menor-i360",
          label: "Acta de nacimiento del menor (copia certificada)",
          hint: "Para confirmar edad y filiación ante USCIS.",
          category: "USCIS",
          extract: [
            { field: "Menor", value: "Mateo Alejandro Rivas Cordero" },
            { field: "Fecha de nacimiento", value: "18/05/2012" },
            { field: "Edad al presentar", value: "14 años (menor de 21)" },
          ],
        },
      ],

      forms: [
        {
          id: "uscis-i360",
          label: "USCIS I-360",
          kind: "pdf",
          progress: 100,
          caption: "Petition for Amerasian, Widow(er), or Special Immigrant",
          sections: [
            {
              title: "Clasificación solicitada",
              items: [
                { q: "Tipo de petición", a: "Special Immigrant Juvenile (SIJ)" },
                { q: "Base legal", a: "8 U.S.C. §1101(a)(27)(J)" },
              ],
            },
            {
              title: "Datos del menor",
              items: [
                { q: "Nombre completo", a: "Mateo Alejandro Rivas Cordero" },
                { q: "Fecha de nacimiento", a: "18 de mayo de 2012" },
                { q: "País de nacimiento", a: "Honduras" },
                { q: "¿Soltero?", a: "Sí" },
              ],
            },
            {
              title: "Orden de la corte estatal",
              items: [
                { q: "Corte", a: "Corte de Familia — Miami-Dade, FL" },
                { q: "Fecha de la orden", a: "12 de junio de 2026" },
                { q: "Hallazgos SIJS", a: "Dependencia, reunificación no viable, mejor interés" },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "Con la orden de la corte, María sube el predicate order y los documentos para USCIS.",
        formularios:
          "El Formulario I-360 ya está completo al 100%, listo para revisar y presentar ante USCIS.",
        review:
          "Cada respuesta del I-360 organizada por el sistema. Solo revisar y enviar.",
      },

      automation: {
        slotKey: "i360",
        title: "Formulario I-360",
        officialTitle:
          "Formulario I-360 · Petition for Amerasian, Widow(er), or Special Immigrant (USCIS)",
        intro: "El sistema llena el I-360 oficial de USCIS a partir de la orden de la corte estatal y los datos del menor.",
        loaderTitle: "Ensamblando el Formulario I-360",
        sourcePanelLabel: "Datos del menor",
        targetPanelLabel: "I-360 oficial · USCIS",
        filledChipLabel: "16 campos vacíos → N/A",
        fillNote: "La clasificación SIJ requiere la orden estatal con los hallazgos especiales; 16 campos sin dato se completaron con “N/A”.",
        previewTitle: "Formulario I-360 — PDF oficial",
        doneMeta: "12 págs · PDF oficial · 16 campos en N/A",
        docKicker: "Formulario oficial · USCIS",
        docPageTitle: "Formulario I-360 — Special Immigrant Juvenile",
        downloadName: "i-360.pdf",
        splash: {
          title: "¡Formulario I-360 generado!",
          body: "El PDF oficial del USCIS quedó completo, listo para presentar.",
        },
        steps: [
          { icon: "form", text: "Leyendo la orden de la corte estatal…" },
          { icon: "doc", text: "Abriendo el PDF oficial I-360 (USCIS)…" },
          { icon: "bolt", text: "Marcando la clasificación Special Immigrant Juvenile…" },
          { icon: "edit", text: "Rellenando campos vacíos con N/A…" },
          { icon: "check", text: "Generando el PDF final…" },
        ],
        fields: [
          { plain: "Clasificación", official: "Part 2 — Classification", fieldName: "ClassificationSIJ", value: "Special Immigrant Juvenile" },
          { plain: "Apellido del menor", official: "Part 3 — Family Name", fieldName: "BeneficiaryLastName", value: "Rivas Cordero" },
          { plain: "Nombre del menor", official: "Part 3 — Given Name", fieldName: "BeneficiaryFirstName", value: "Mateo Alejandro" },
          { plain: "Fecha de nacimiento", official: "Part 3 — Date of Birth", fieldName: "BeneficiaryDOB", value: "05/18/2012" },
          { plain: "País de nacimiento", official: "Part 3 — Country of Birth", fieldName: "CountryOfBirth", value: "Honduras" },
          { plain: "¿Soltero?", official: "Part 3 — Marital Status", fieldName: "MaritalStatus", value: "Single" },
          { plain: "Corte estatal", official: "Part 4 — Juvenile Court", fieldName: "JuvenileCourt", value: "Miami-Dade Family Court, FL" },
          { plain: "Fecha de la orden", official: "Part 4 — Order Date", fieldName: "OrderDate", value: "06/12/2026" },
          { plain: "Número A (Alien Number)", official: "Part 3 — A-Number", fieldName: "ANumber", value: null },
          { plain: "Firma del abogado", official: "Part 8 — Attorney Signature", fieldName: "AttorneySignature", value: null },
        ],
      },

      generation: {
        slotKey: "i360-peticion",
        title: "Petición I-360 (SIJS)",
        caption: "Escrito de apoyo a la petición I-360 ante USCIS.",
        intro: "La IA redacta el escrito de apoyo del I-360 demostrando que el menor califica como Inmigrante Juvenil Especial a partir de la orden estatal.",
        loaderTitle: "Generando la petición I-360",
        previewTitle: "Petición I-360 — Special Immigrant Juvenile",
        snippet:
          "The beneficiary, a 14-year-old unmarried child, qualifies for Special Immigrant Juvenile classification under 8 U.S.C. §1101(a)(27)(J): a state court has found him dependent, reunification with his father not viable due to abandonment, and return to Honduras contrary to his best interest.",
        longSummary:
          "El menor, Mateo Alejandro Rivas Cordero, de 14 años y soltero, califica como Inmigrante Juvenil Especial conforme a 8 U.S.C. §1101(a)(27)(J). La Corte de Familia de Miami-Dade emitió la orden predicado con los tres hallazgos requeridos: dependencia del menor de la corte, no viabilidad de la reunificación con el padre por abandono, y que no es en su mejor interés regresar a Honduras. El presente escrito sustenta ante USCIS que se cumplen todos los elementos de la clasificación SIJ y que la petición I-360 debe ser aprobada.",
        indexTitle: "Índice de la petición",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "5,480 palabras · 28 páginas · listo",
        downloadName: "peticion-i360.pdf",
        splash: {
          title: "¡Petición I-360 generada!",
          body: "El escrito de apoyo del I-360 está listo para revisión legal.",
        },
        stats: [
          { value: "5,480", label: "palabras" },
          { value: "28", label: "páginas" },
          { value: "3", label: "hallazgos SIJS" },
          { value: "7", label: "fuentes verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 5480 },
          { label: "páginas", value: 28 },
          { label: "citas verificadas", value: 9 },
        ],
        steps: [
          { icon: "doc", text: "Extrayendo la orden de la corte estatal…" },
          { icon: "scale", text: "Analizando los elementos de la clasificación SIJ…" },
          { icon: "search", text: "Revisando la jurisprudencia de USCIS aplicable…" },
          { icon: "edit", text: "Redactando el escrito de apoyo…" },
          { icon: "shield", text: "Verificando citas y enlaces legales…" },
          { icon: "sparkle", text: "Ensamblando la petición final…" },
        ],
        sections: [
          "I. Statement of Eligibility (SIJ)",
          "II. State Court Predicate Order",
          "III. Dependency Finding",
          "IV. Non-Viability of Parental Reunification",
          "V. Best Interest Determination",
          "VI. Conclusion & Request for Approval",
        ],
      },
    },

    {
      slug: "i485",
      label: "I-485",
      color: "green",

      documents: [
        {
          id: "aprobacion-i360",
          label: "Aprobación del I-360 (I-797)",
          hint: "El aviso de aprobación de USCIS — habilita el ajuste de estatus.",
          category: "USCIS",
          extract: [
            { field: "Documento", value: "Notice of Approval — Form I-797" },
            { field: "Petición", value: "I-360 · Special Immigrant Juvenile" },
            { field: "Beneficiario", value: "Mateo Alejandro Rivas Cordero" },
            { field: "Prioridad", value: "Visa disponible (EB-4)" },
          ],
        },
        {
          id: "examen-medico",
          label: "Examen médico (I-693)",
          hint: "Realizado por un cirujano civil autorizado por USCIS.",
          category: "USCIS",
          extract: [
            { field: "Formulario", value: "I-693 — sellado" },
            { field: "Cirujano civil", value: "Autorizado por USCIS" },
            { field: "Vacunas", value: "Completas al día" },
            { field: "Estado", value: "Sin condiciones inadmisibles" },
          ],
        },
        {
          id: "antecedentes",
          label: "Antecedentes y registros de la corte juvenil",
          hint: "Constancias requeridas para el ajuste de estatus.",
          category: "Ajuste de estatus",
          extract: [
            { field: "Antecedentes penales", value: "Ninguno (menor de edad)" },
            { field: "Registros corte juvenil", value: "Orden SIJS incluida" },
            { field: "Uso", value: "Elegibilidad para la Green Card" },
          ],
        },
        {
          id: "fotos-i485",
          label: "Fotos tipo pasaporte (USCIS)",
          hint: "Dos fotos 2x2 recientes del menor.",
          category: "USCIS",
          extract: [
            { field: "Formato", value: "2x2 pulgadas, fondo blanco" },
            { field: "Cantidad", value: "2 fotos" },
            { field: "Tomadas", value: "Agosto 2026" },
          ],
        },
      ],

      forms: [
        {
          id: "uscis-i485",
          label: "USCIS I-485",
          kind: "pdf",
          progress: 100,
          caption: "Application to Register Permanent Residence or Adjust Status",
          sections: [
            {
              title: "Categoría de elegibilidad",
              items: [
                { q: "Base del ajuste", a: "Special Immigrant Juvenile (Form I-360)" },
                { q: "Casilla marcada", a: "Special Immigrant Juvenile" },
              ],
            },
            {
              title: "Datos del solicitante",
              items: [
                { q: "Nombre completo", a: "Mateo Alejandro Rivas Cordero" },
                { q: "Fecha de nacimiento", a: "18 de mayo de 2012" },
                { q: "País de nacimiento", a: "Honduras" },
              ],
            },
            {
              title: "Carga pública",
              items: [
                { q: "¿Aplica la carga pública?", a: "No — exención para SIJ." },
              ],
            },
          ],
        },
        {
          id: "uscis-i765",
          label: "USCIS I-765 — Permiso de trabajo",
          kind: "pdf",
          progress: 100,
          caption: "Application for Employment Authorization (categoría (c)(9))",
          sections: [
            {
              title: "Categoría",
              items: [
                { q: "Elegibilidad", a: "(c)(9) — ajuste de estatus pendiente" },
                { q: "Solicitante", a: "Mateo Alejandro Rivas Cordero" },
              ],
            },
          ],
        },
        {
          id: "uscis-i131",
          label: "USCIS I-131 — Permiso de viaje",
          kind: "pdf",
          progress: 100,
          caption: "Application for Travel Document (advance parole)",
          sections: [
            {
              title: "Tipo de documento",
              items: [
                { q: "Solicita", a: "Advance parole (viaje durante el ajuste)" },
                { q: "Solicitante", a: "Mateo Alejandro Rivas Cordero" },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "Con el I-360 aprobado, María sube la aprobación y el examen médico para el ajuste de estatus.",
        formularios:
          "El I-485, el permiso de trabajo (I-765) y el de viaje (I-131) ya están completos al 100%.",
        review:
          "Cada respuesta del paquete de ajuste organizada por el sistema. Solo revisar y enviar.",
      },

      automation: {
        slotKey: "i485",
        title: "Formulario I-485 (+ I-765/I-131)",
        officialTitle:
          "Formulario I-485 · Application to Register Permanent Residence or Adjust Status (USCIS)",
        intro: "El sistema llena el I-485 oficial de USCIS marcando la categoría SIJ y la exención de carga pública.",
        loaderTitle: "Ensamblando el Formulario I-485",
        sourcePanelLabel: "Datos del menor",
        targetPanelLabel: "I-485 oficial · USCIS",
        filledChipLabel: "22 campos vacíos → N/A",
        fillNote: "Se marca la categoría Special Immigrant Juvenile (Part 2, línea 3.c) y la exención de carga pública (Part 9); 22 campos sin dato se completaron con “N/A”.",
        previewTitle: "Formulario I-485 — PDF oficial",
        doneMeta: "20 págs · PDF oficial · 22 campos en N/A",
        docKicker: "Formulario oficial · USCIS",
        docPageTitle: "Formulario I-485 — Ajuste de estatus (SIJ)",
        downloadName: "i-485.pdf",
        splash: {
          title: "¡Formulario I-485 generado!",
          body: "El paquete de ajuste de estatus quedó completo, listo para presentar.",
        },
        steps: [
          { icon: "form", text: "Leyendo la aprobación del I-360…" },
          { icon: "doc", text: "Abriendo el PDF oficial I-485 (USCIS)…" },
          { icon: "bolt", text: "Marcando la categoría SIJ y la exención de carga pública…" },
          { icon: "edit", text: "Rellenando campos vacíos con N/A…" },
          { icon: "check", text: "Generando el PDF final…" },
        ],
        fields: [
          { plain: "Categoría de elegibilidad", official: "Part 2 — Line 3.c", fieldName: "pt2line3c_cb_1", value: "Special Immigrant Juvenile, Form I-360" },
          { plain: "Apellido", official: "Part 1 — Family Name", fieldName: "ApplicantLastName", value: "Rivas Cordero" },
          { plain: "Nombre", official: "Part 1 — Given Name", fieldName: "ApplicantFirstName", value: "Mateo Alejandro" },
          { plain: "Fecha de nacimiento", official: "Part 1 — Date of Birth", fieldName: "ApplicantDOB", value: "05/18/2012" },
          { plain: "País de nacimiento", official: "Part 1 — Country of Birth", fieldName: "CountryOfBirth", value: "Honduras" },
          { plain: "N.º de recibo I-360", official: "Part 2 — Receipt Number", fieldName: "I360ReceiptNumber", value: "IOE0912345678" },
          { plain: "Exención de carga pública", official: "Part 9 — Line 56", fieldName: "pt9line56_cb_6", value: "Public charge exemption — SIJ" },
          { plain: "Número A (Alien Number)", official: "Part 1 — A-Number", fieldName: "ANumber", value: null },
          { plain: "Examen médico (I-693)", official: "Supporting — Form I-693", fieldName: "MedicalExam", value: "Attached (sealed)" },
          { plain: "Firma del abogado", official: "Part 11 — Attorney Signature", fieldName: "AttorneySignature", value: null },
        ],
      },

      generation: {
        slotKey: "i485-paquete",
        title: "Paquete de ajuste I-485",
        caption: "Escrito de apoyo y ensamblado del paquete de ajuste de estatus.",
        intro: "La IA redacta el escrito de apoyo del ajuste de estatus y ensambla el paquete completo I-485 con I-765, I-131 e I-693.",
        loaderTitle: "Generando el paquete de ajuste I-485",
        previewTitle: "Paquete de ajuste I-485 (SIJ)",
        snippet:
          "The applicant, an approved Special Immigrant Juvenile with an available EB-4 visa, is eligible to adjust status to Lawful Permanent Resident under INA §245: the I-360 is approved, the medical exam is complete, and the public-charge ground does not apply to SIJ beneficiaries.",
        longSummary:
          "El menor, Mateo Alejandro Rivas Cordero, con su petición I-360 aprobada y visa EB-4 disponible, es elegible para ajustar su estatus a Residente Permanente Legal (Green Card) conforme a la INA §245. El paquete integra el Formulario I-485, la solicitud de permiso de trabajo (I-765), el permiso de viaje (I-131) y el examen médico sellado (I-693). El escrito sustenta que se cumplen todos los requisitos del ajuste y que la carga pública no aplica a los beneficiarios SIJ, solicitando la aprobación de la residencia permanente.",
        indexTitle: "Índice del paquete",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "9,240 palabras · 87 páginas · listo",
        downloadName: "paquete-i485.pdf",
        splash: {
          title: "¡Paquete I-485 generado!",
          body: "El paquete de ajuste de estatus está listo para revisión legal.",
        },
        stats: [
          { value: "9,240", label: "palabras" },
          { value: "87", label: "páginas" },
          { value: "4", label: "formularios USCIS" },
          { value: "8", label: "fuentes verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 9240 },
          { label: "páginas", value: 87 },
          { label: "citas verificadas", value: 11 },
        ],
        steps: [
          { icon: "doc", text: "Extrayendo la aprobación del I-360…" },
          { icon: "scale", text: "Analizando la elegibilidad para el ajuste (INA §245)…" },
          { icon: "form", text: "Ensamblando I-485, I-765, I-131 e I-693…" },
          { icon: "edit", text: "Redactando el escrito de apoyo…" },
          { icon: "shield", text: "Verificando citas y la exención de carga pública…" },
          { icon: "sparkle", text: "Ensamblando el paquete final…" },
        ],
        sections: [
          "I. Adjustment Eligibility (INA §245)",
          "II. Approved I-360 & Visa Availability (EB-4)",
          "III. Medical Examination (I-693)",
          "IV. Public Charge Exemption for SIJ",
          "V. Employment & Travel Authorization (I-765, I-131)",
          "VI. Conclusion & Request for Approval",
        ],
      },
    },
  ],

  staff: {
    caseNumber: "ULP-2026-0031",
    clientLegalName: "Mateo Alejandro Rivas Cordero",
    clientPhone: "+1 (305) 555-0131",
    planLabel: "Visa Juvenil (SIJS) · Con abogado",
    statusLabel: "Activo",
    owner: { name: "Diana Torres", role: "Paralegal" },

    keyFacts: [
      { label: "Menor", value: "Mateo Alejandro Rivas Cordero (14 años)" },
      { label: "Tutora", value: "María Cordero Lanza (madre)" },
      { label: "País de origen", value: "Honduras" },
      { label: "Base del caso", value: "SIJS — abandono paterno (8 U.S.C. §1101(a)(27)(J))" },
      { label: "Corte estatal", value: "Corte de Familia — Miami-Dade, FL" },
      { label: "Fases", value: "Custodia → I-360 → I-485" },
    ],

    timeline: [
      { icon: "check", title: "Contrato firmado por la tutora", when: "Hace 8 días" },
      { icon: "dollar", title: "Cuota inicial confirmada — caso activo", when: "Hace 8 días" },
      { icon: "family", title: "Fase 1: petición de custodia con hallazgos SIJS generada", when: "Hace 6 días" },
      { icon: "scale", title: "Orden de la corte estatal recibida (predicate order)", when: "Hace 4 días" },
      { icon: "form", title: "Fase 2: Formulario I-360 presentado ante USCIS", when: "Hace 2 días" },
      { icon: "briefcase", title: "Fase 3: paquete I-485 en preparación", when: "Hoy" },
    ],

    docsApproved: 14,
    docsTotal: 14,
    formsDone: 6,
    formsTotal: 6,

    translateSteps: [
      { icon: "sparkle", text: "Analizando el documento con IA…" },
      { icon: "search", text: "Extrayendo la información clave…" },
      { icon: "doc", text: "Leyendo el texto del documento (OCR)…" },
      { icon: "globe", text: "Traduciendo al inglés…" },
      { icon: "check", text: "Certificando la traducción…" },
    ],

    expediente: {
      slotKey: "expediente",
      title: "Expediente SIJS completo",
      caption: "Custodia, I-360 e I-485 con todos sus anexos en un solo PDF.",
      intro: "El sistema arma el expediente SIJS completo que cruza las tres fases: petición de custodia, I-360, paquete I-485 y anexos.",
      loaderTitle: "Compilando el expediente SIJS",
      toolbarNote: "Expediente SIJS compilado y listo para revisión legal.",
      downloadName: "expediente-sijs.pdf",
      splash: {
        title: "¡Expediente compilado!",
        body: "El expediente SIJS completo está listo. Puedes revisarlo e imprimirlo.",
      },
      coverTitle: "EXPEDIENTE VISA JUVENIL (SIJS)",
      coverSubtitle: "Custodia estatal · I-360 · I-485 — Estatus Especial de Inmigrante Juvenil",
      coverRows: [
        { label: "Menor", value: "Mateo Alejandro Rivas Cordero" },
        { label: "Tutora", value: "María Cordero Lanza (madre)" },
        { label: "Servicio", value: "Visa Juvenil (SIJS)" },
        { label: "Plan", value: "Visa Juvenil (SIJS) · Con abogado" },
        { label: "Número de caso", value: "ULP-2026-0031" },
        { label: "Responsable", value: "Diana Torres · Paralegal" },
      ],
      chronology: [
        { when: "2016", event: "El padre del menor abandona el hogar en Honduras y cesa todo contacto y manutención." },
        { when: "Mar 2023", event: "Mateo ingresa a EE. UU. como menor no acompañado y queda al cuidado de su madre en Hialeah, FL." },
        { when: "May 2026", event: "Fase 1 — se genera la petición de custodia con los hallazgos especiales SIJS ante la corte de familia." },
        { when: "12 Jun 2026", event: "La Corte de Familia de Miami-Dade emite la orden con los hallazgos SIJS (predicate order)." },
        { when: "Jun 2026", event: "Fase 2 — se presenta el Formulario I-360 (Special Immigrant Juvenile) ante USCIS." },
        { when: "Hoy", event: "Fase 3 — se compila el paquete I-485 de ajuste de estatus a Residente Permanente Legal." },
      ],
      samplePages: { form: 34, generation: 52, anexos: 96, chronology: 118 },
      totalPages: 119,
      steps: [
        { icon: "shield", text: "Generando la carátula legal…" },
        { icon: "doc", text: "Ensamblando custodia, I-360 e I-485…" },
        { icon: "clip", text: "Agregando los anexos de las tres fases…" },
        { icon: "form", text: "Numerando las páginas…" },
        { icon: "check", text: "Compilando el PDF final…" },
      ],
      toc: [
        { title: "Carátula", page: 1 },
        { title: "Índice de contenidos", page: 2 },
        { title: "Fase 1 — Petición de custodia con hallazgos SIJS", page: 3 },
        { title: "Orden de la corte estatal (predicate order)", page: 18 },
        { title: "Fase 2 — Formulario I-360 (Special Immigrant Juvenile)", page: 22 },
        { title: "Petición I-360 — escrito de apoyo", page: 24 },
        { title: "Fase 3 — Formulario I-485 (ajuste de estatus)", page: 34 },
        { title: "Paquete I-485 — escrito de apoyo", page: 52 },
        { title: "Anexo A — Sustento SIJS (Fase 1)", page: 96 },
        { title: "Anexo B — USCIS (Fases 2 y 3)", page: 108 },
        { title: "Tabla cronológica del proceso", page: 118 },
      ],
      anexos: [
        {
          group: "Fase 1 · Custodia (sustento SIJS)",
          items: [
            "Acta de nacimiento del menor",
            "Identificación del menor y de la tutora",
            "Evidencias de abandono paterno",
            "Registros escolares del menor",
            "Comprobante de domicilio de la tutora",
          ],
        },
        {
          group: "Fase 2 · I-360 (USCIS)",
          items: [
            "Orden de custodia con hallazgos SIJS (predicate order)",
            "I-94 del menor",
            "Fotos tipo pasaporte (USCIS)",
            "Acta de nacimiento (copia certificada)",
          ],
        },
        {
          group: "Fase 3 · I-485 (ajuste de estatus)",
          items: [
            "Aprobación del I-360 (I-797)",
            "Examen médico (I-693)",
            "Antecedentes y registros de la corte juvenil",
            "Solicitudes I-765 (trabajo) e I-131 (viaje)",
          ],
        },
      ],
    },
  },
};
