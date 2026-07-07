import type { DemoScenario } from "./types";

/**
 * Asilo Político — escenario demo de "Karelis" (cliente ficticia, 3 hijos).
 *
 * Combina artefactos de fase 1 y fase 2 en un solo flujo simplificado para el
 * live. Todo es contenido inventado: ningún dato real, ningún PII. Los nombres
 * de los documentos están deliberadamente "combinados" (un renglón por tipo,
 * no por persona) porque así se pidió para el demo. Servicio de una sola fase:
 * `phases` lleva un único elemento.
 */
export const asiloPolitico: DemoScenario = {
  slug: "asilo-politico",
  service: { label: "Asilo Político", icon: "shield", color: "green" },
  client: {
    firstName: "Karelis",
    parties: [
      { name: "Karelis", role: "applicant" },
      { name: "Alexander", role: "dependent" },
      { name: "Kamila", role: "dependent" },
      { name: "Amanda", role: "dependent" },
    ],
  },
  caseTitle: "Asilo Político — Karelis",
  phaseLabel: "Fase 1 de 2 · Preparación",

  contract: {
    planLabel: "Asilo Político · Con abogado",
    nextAmount: "$500",
    installments: [
      { label: "Cuota inicial", amount: "$500", due: "Hoy", isDownPayment: true },
      { label: "Cuota 2", amount: "$300", due: "5 ago" },
      { label: "Cuota 3", amount: "$300", due: "5 sep" },
      { label: "Cuota 4", amount: "$300", due: "5 oct" },
      { label: "Cuota 5", amount: "$300", due: "5 nov" },
      { label: "Cuota 6", amount: "$300", due: "5 dic" },
    ],
    clauses: [
      {
        title: "1. Objeto del servicio",
        body: "UsaLatinoPrime acompañará a la solicitante en la preparación y presentación de su solicitud de asilo político ante USCIS, incluyendo la integración de su expediente, el llenado del Formulario I-589 y la asesoría legal durante el proceso.",
      },
      {
        title: "2. Honorarios y forma de pago",
        body: "El cliente acepta el plan de pagos detallado: una cuota inicial y cinco cuotas mensuales. El servicio se activa una vez confirmada la cuota inicial. Las tarifas oficiales de USCIS no están incluidas en estos honorarios.",
      },
      {
        title: "3. Alcance y responsabilidades",
        body: "El cliente se compromete a entregar documentación verídica y completa. UsaLatinoPrime prepara el caso con la mayor diligencia profesional; ninguna parte garantiza un resultado específico, ya que la decisión final corresponde a la autoridad migratoria.",
      },
      {
        title: "4. Confidencialidad",
        body: "Toda la información compartida se trata de forma estrictamente confidencial y se utiliza únicamente para los fines del presente servicio legal.",
      },
    ],
  },

  captions: {
    cases:
      "Así ve Karelis su caso recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma su contrato en segundos, directo desde el teléfono.",
    pagos: "Paga su primera cuota de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
  },

  phases: [
    {
      slug: "principal",
      label: "Asilo Político",

      documents: [
        {
          id: "passports",
          label: "Pasaportes de Karelis, Alexander, Kamila y Amanda",
          hint: "Página de datos, nítida y completa.",
          category: "Identidad",
          extract: [
            { field: "Nombre", value: "Karelis Rondón Salazar" },
            { field: "N.º de pasaporte", value: "V-148820376" },
            { field: "Nacionalidad", value: "Venezolana" },
            { field: "Fecha de nacimiento", value: "14/03/1990" },
            { field: "Vencimiento", value: "22/09/2029" },
          ],
        },
        {
          id: "ids",
          label: "Cédulas / documentos de identidad de Karelis, Alexander, Kamila y Amanda",
          hint: "Anverso y reverso.",
          category: "Identidad",
          extract: [
            { field: "Documento", value: "Cédula de identidad (V)" },
            { field: "Titular", value: "Karelis Rondón Salazar" },
            { field: "N.º de cédula", value: "V-24.881.203" },
            { field: "Estado civil", value: "Soltera" },
          ],
        },
        {
          id: "address",
          label: "Comprobante de domicilio",
          hint: "Recibo o carta a nombre de la solicitante.",
          category: "Domicilio",
          extract: [
            { field: "Titular", value: "Karelis Rondón Salazar" },
            { field: "Dirección", value: "3820 NW 7th St, Apt 4" },
            { field: "Ciudad / Estado", value: "Miami, FL 33126" },
            { field: "Emitido", value: "Mayo 2025" },
          ],
        },
        {
          id: "i94",
          label: "Formularios I-94 de Karelis, Alexander, Kamila y Amanda",
          hint: "Registro de entrada/salida de EE. UU.",
          category: "Migratorio",
          extract: [
            { field: "Titular", value: "Karelis Rondón Salazar" },
            { field: "N.º de admisión I-94", value: "581992047A3" },
            { field: "Fecha de entrada", value: "08/02/2024" },
            { field: "Puerto de entrada", value: "Eagle Pass, TX" },
            { field: "Clase de admisión", value: "Solicitante de asilo" },
          ],
        },
        {
          id: "birth-certs",
          label: "Actas de nacimiento de Alexander, Kamila y Amanda + declaración jurada",
          hint: "Apostilladas si están disponibles.",
          category: "Familia",
          extract: [
            { field: "Hijo/a 1", value: "Alexander Rondón — 12 años" },
            { field: "Hijo/a 2", value: "Kamila Rondón — 9 años" },
            { field: "Hijo/a 3", value: "Amanda Rondón — 6 años" },
            { field: "Vínculo", value: "Madre — Karelis Rondón Salazar" },
          ],
        },
        {
          id: "medical",
          label: "Informe médico",
          hint: "Documenta condiciones físicas relevantes al caso.",
          category: "Soporte del caso",
          extract: [
            { field: "Tipo", value: "Informe médico" },
            { field: "Hallazgos", value: "Lesiones compatibles con agresión" },
            { field: "Emitido por", value: "Clínica comunitaria, Miami" },
            { field: "Fecha", value: "Marzo 2025" },
          ],
        },
        {
          id: "psych",
          label: "Informe psicológico",
          hint: "Evalúa el impacto emocional de la persecución.",
          category: "Soporte del caso",
          extract: [
            { field: "Tipo", value: "Evaluación psicológica" },
            { field: "Diagnóstico", value: "Estrés postraumático (TEPT)" },
            { field: "Relación con el caso", value: "Consistente con persecución" },
            { field: "Fecha", value: "Abril 2025" },
          ],
        },
      ],

      forms: [
        {
          id: "i589",
          label: "Formulario I-589",
          kind: "pdf",
          progress: 100,
          caption: "Solicitud de Asilo y de Suspensión de Expulsión",
          sections: [
            {
              title: "Información del solicitante",
              items: [
                { q: "Nombre completo", a: "Karelis Rondón Salazar" },
                { q: "País de nacionalidad", a: "Venezuela" },
                { q: "Fecha de nacimiento", a: "14 de marzo de 1990" },
                { q: "Estado civil", a: "Soltera" },
                { q: "Idioma principal", a: "Español" },
              ],
            },
            {
              title: "Dependientes incluidos",
              items: [
                { q: "Hijo/a 1", a: "Alexander Rondón — 12 años" },
                { q: "Hijo/a 2", a: "Kamila Rondón — 9 años" },
                { q: "Hijo/a 3", a: "Amanda Rondón — 6 años" },
              ],
            },
            {
              title: "Base de la solicitud de asilo",
              items: [
                { q: "Motivo de persecución", a: "Opinión política" },
                { q: "¿Sufrió daño o amenazas?", a: "Sí, en reiteradas ocasiones" },
                {
                  q: "Descripción breve",
                  a: "Tras participar en manifestaciones pacíficas, fue amenazada y vigilada por grupos afines al régimen, lo que la obligó a huir con sus hijos.",
                },
              ],
            },
            {
              title: "Antecedentes de viaje",
              items: [
                { q: "Fecha de entrada a EE. UU.", a: "8 de febrero de 2024" },
                { q: "Puerto de entrada", a: "Eagle Pass, Texas" },
                { q: "Estatus al ingresar", a: "Solicitante de asilo" },
              ],
            },
            {
              title: "Declaración",
              items: [
                {
                  q: "¿La información es verídica?",
                  a: "Sí, declarada bajo pena de perjurio.",
                },
              ],
            },
          ],
        },
        {
          id: "fear-memo",
          label: "Memorándum de Miedo Creíble",
          kind: "letter",
          progress: 100,
          caption: "Sustento legal del temor fundado de persecución",
          sections: [
            {
              title: "Relato del temor",
              items: [
                {
                  q: "Resumen del temor fundado",
                  a: "La solicitante teme por su vida y la de sus hijos si regresa a su país, debido a persecución por sus opiniones políticas expresadas públicamente.",
                },
              ],
            },
            {
              title: "Agente persecutor",
              items: [
                { q: "¿Quién la persigue?", a: "Grupos paraestatales con respaldo del gobierno" },
                { q: "¿El Estado puede protegerla?", a: "No; las denuncias presentadas no tuvieron respuesta" },
              ],
            },
            {
              title: "Intentos de protección",
              items: [
                {
                  q: "¿Buscó ayuda en su país?",
                  a: "Sí, acudió a las autoridades locales sin obtener protección efectiva.",
                },
                {
                  q: "¿Podría reubicarse internamente?",
                  a: "No; el alcance del agente persecutor es nacional.",
                },
              ],
            },
            {
              title: "Conclusión legal",
              items: [
                {
                  q: "Fundamento del asilo",
                  a: "El caso cumple los elementos de un temor fundado de persecución por opinión política conforme a la INA §208.",
                },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "Sube cada documento guiada paso a paso. El sistema sabe exactamente qué pedir.",
        formularios:
          "Sus formularios legales ya están completos al 100%, listos para revisar.",
        review:
          "Cada respuesta del I-589 generada y organizada por el sistema. Solo revisar y enviar.",
      },

      automation: {
        slotKey: "i589",
        title: "Formulario I-589",
        officialTitle:
          "Formulario I-589 · Solicitud de Asilo y de Suspensión de Expulsión (USCIS)",
        intro: "El sistema llena el formulario oficial del USCIS a partir de las respuestas del cliente.",
        loaderTitle: "Ensamblando el Formulario I-589",
        sourcePanelLabel: "Formulario de Karelis",
        targetPanelLabel: "I-589 oficial · USCIS",
        filledChipLabel: "34 campos vacíos → N/A",
        fillNote: "34 campos sin dato se completaron automáticamente con “N/A” (8 CFR 1208.3(c)(3)).",
        previewTitle: "Formulario I-589 — PDF oficial",
        doneMeta: "12 págs · PDF oficial · 34 campos en N/A",
        docKicker: "Formulario oficial · USCIS",
        docPageTitle: "Formulario I-589 — Parte A",
        downloadName: "i-589.pdf",
        splash: {
          title: "¡Formulario I-589 generado!",
          body: "El PDF oficial del USCIS quedó completo, sin campos en blanco.",
        },
        steps: [
          { icon: "form", text: "Leyendo las respuestas del formulario…" },
          { icon: "doc", text: "Abriendo el PDF oficial I-589 (USCIS)…" },
          { icon: "bolt", text: "Mapeando cada dato a su campo oficial…" },
          { icon: "edit", text: "Rellenando campos vacíos con N/A…" },
          { icon: "check", text: "Generando el PDF final…" },
        ],
        fields: [
          { plain: "Apellido", official: "Parte A.I · Línea 4 — Last Name", fieldName: "PtAILine4_LastName", value: "Rondón Salazar" },
          { plain: "Nombre", official: "Parte A.I · Línea 5 — First Name", fieldName: "PtAILine5_FirstName", value: "Karelis" },
          { plain: "Segundo nombre", official: "Parte A.I · Línea 6 — Middle Name", fieldName: "PtAILine6_MiddleName", value: null },
          { plain: "Fecha de nacimiento", official: "Parte A.I · Línea 7 — Date of Birth", fieldName: "DateTimeField1", value: "03/14/1990" },
          { plain: "Sexo", official: "Parte A.I · Línea 9 — Sex", fieldName: "PartALine9Sex", value: "Female" },
          { plain: "Estado civil", official: "Parte A.I · Línea 10 — Marital Status", fieldName: "Marital", value: "Single" },
          { plain: "País de nacimiento", official: "Parte A.I · Línea 11 — Country of Birth", fieldName: "TextField3", value: "Venezuela" },
          { plain: "Nacionalidad", official: "Parte A.I · Línea 13 — Nationality", fieldName: "TextField4", value: "Venezuelan" },
          { plain: "Número A (Alien Number)", official: "Parte A.I · Línea 1 — A-Number", fieldName: "PtAILine1_ANumber", value: null },
          { plain: "Dirección en EE. UU.", official: "Parte A.I · Línea 8 — Street", fieldName: "PtAILine8_StreetNumandName", value: "3820 NW 7th St, Apt 4" },
          { plain: "Ciudad", official: "Parte A.I · Línea 8 — City", fieldName: "TextField1[2]", value: "Miami" },
          { plain: "Estado", official: "Parte A.I · Línea 8 — State", fieldName: "PtAILine8_State", value: "FL" },
          { plain: "Código postal", official: "Parte A.I · Línea 8 — Zip Code", fieldName: "PtAILine8_Zipcode", value: "33126" },
        ],
      },

      generation: {
        slotKey: "memo",
        title: "Memorándum de Miedo Creíble",
        caption: "Sustento legal del temor fundado de persecución.",
        intro: "La IA redacta el memorándum legal a partir del expediente, la jurisprudencia y las condiciones del país.",
        loaderTitle: "Generando el Memorándum de Miedo Creíble",
        previewTitle: "Memorándum de Miedo Creíble",
        snippet:
          "La solicitante presenta un temor fundado de persecución por su opinión política, sustentado en la INA §208 y la jurisprudencia federal aplicable.",
        longSummary:
          "La solicitante, Karelis Rondón Salazar, ciudadana venezolana, presenta un temor fundado de persecución por su opinión política. Tras participar en manifestaciones pacíficas contra el régimen, fue amenazada, vigilada y agredida por grupos paraestatales, sin que el Estado ofreciera protección efectiva. El presente memorándum sustenta, con fundamento en la INA §208 y la jurisprudencia federal aplicable, que su caso satisface los elementos de un temor creíble de persecución.",
        indexTitle: "Índice del memorándum",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "69,103 palabras · 251 páginas · listo",
        downloadName: "memorandum.pdf",
        splash: {
          title: "¡Memorándum generado!",
          body: "El memorándum de miedo creíble está listo para revisión.",
        },
        stats: [
          { value: "69,103", label: "palabras" },
          { value: "251", label: "páginas" },
          { value: "6", label: "precedentes" },
          { value: "6", label: "fuentes verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 69103 },
          { label: "páginas", value: 251 },
          { label: "citas verificadas", value: 12 },
        ],
        steps: [
          { icon: "doc", text: "Extrayendo de los documentos del caso…" },
          { icon: "search", text: "Leyendo la información de la solicitante…" },
          { icon: "scale", text: "Analizando la jurisprudencia aplicable…" },
          { icon: "globe", text: "Revisando las condiciones del país…" },
          { icon: "edit", text: "Redactando las 17 secciones…" },
          { icon: "shield", text: "Verificando citas y enlaces legales…" },
          { icon: "sparkle", text: "Ensamblando el memorándum…" },
        ],
        sections: [
          "I. Antecedentes de la solicitante",
          "II. Persecución sufrida",
          "III. Temor fundado de persecución futura",
          "IV. Nexo con la opinión política",
          "V. Análisis legal (INA §208)",
          "VI. Imposibilidad de reubicación interna",
          "VII. Conclusión y petición",
        ],
      },
    },
  ],

  staff: {
    caseNumber: "ULP-2026-0042",
    clientLegalName: "Karelis Rondón Salazar",
    clientPhone: "+1 (305) 555-0142",
    planLabel: "Asilo Político · Con abogado",
    statusLabel: "Activo",
    owner: { name: "Diana Torres", role: "Paralegal" },

    keyFacts: [
      { label: "Solicitante", value: "Karelis Rondón Salazar" },
      { label: "Dependientes", value: "Alexander, Kamila y Amanda" },
      { label: "País de origen", value: "Venezuela" },
      { label: "Base del caso", value: "Persecución por opinión política" },
      { label: "Ingreso a EE. UU.", value: "8 de febrero de 2024" },
      { label: "Puerto de entrada", value: "Eagle Pass, Texas" },
    ],

    timeline: [
      { icon: "check", title: "Contrato firmado por la clienta", when: "Hace 6 días" },
      { icon: "dollar", title: "Cuota inicial confirmada — caso activo", when: "Hace 6 días" },
      { icon: "upload", title: "7 documentos cargados y aprobados", when: "Hace 4 días" },
      { icon: "form", title: "Formulario I-589 completado al 100%", when: "Hace 2 días" },
      { icon: "sparkle", title: "Memorándum de Miedo Creíble generado", when: "Ayer" },
      { icon: "shield", title: "Expediente listo para validación legal", when: "Hoy" },
    ],

    docsApproved: 7,
    docsTotal: 7,
    formsDone: 2,
    formsTotal: 2,

    translateSteps: [
      { icon: "sparkle", text: "Analizando el documento con IA…" },
      { icon: "search", text: "Extrayendo la información clave…" },
      { icon: "doc", text: "Leyendo el texto del documento (OCR)…" },
      { icon: "globe", text: "Traduciendo al inglés…" },
      { icon: "check", text: "Certificando la traducción…" },
    ],

    expediente: {
      slotKey: "expediente",
      title: "Expediente legal",
      caption: "Carátula, índice, I-589, memorándum y anexos en un solo PDF.",
      intro: "El sistema arma el expediente legal completo: carátula, formularios, memorándum y anexos.",
      loaderTitle: "Compilando el expediente legal",
      toolbarNote: "Expediente compilado y listo para revisión legal.",
      downloadName: "expediente.pdf",
      splash: {
        title: "¡Expediente compilado!",
        body: "Tu expediente legal está listo. Puedes revisarlo e imprimirlo.",
      },
      coverTitle: "EXPEDIENTE DE ASILO POLÍTICO",
      coverSubtitle: "Solicitud I-589 · Memorándum de Miedo Creíble",
      coverRows: [
        { label: "Solicitante", value: "Karelis Rondón Salazar" },
        { label: "Dependientes", value: "Alexander, Kamila y Amanda Rondón" },
        { label: "Servicio", value: "Asilo Político (I-589)" },
        { label: "Plan", value: "Asilo Político · Con abogado" },
        { label: "Número de caso", value: "ULP-2026-0042" },
        { label: "Responsable", value: "Diana Torres · Paralegal" },
      ],
      chronology: [
        { when: "2018", event: "Se une a un partido político opositor y participa en manifestaciones pacíficas." },
        { when: "2021", event: "Recibe la primera amenaza directa tras liderar una protesta comunitaria." },
        { when: "2022", event: "Es vigilada y hostigada de forma reiterada por grupos afines al régimen." },
        { when: "2023", event: "Sufre una agresión física documentada en el informe médico del expediente." },
        { when: "Feb 2024", event: "Huye de Venezuela con sus tres hijos e ingresa a EE. UU. por Eagle Pass, Texas." },
        { when: "2025", event: "Presenta su solicitud de asilo (Formulario I-589) ante USCIS." },
      ],
      samplePages: { form: 3, generation: 15, anexos: 266, chronology: 283 },
      totalPages: 284,
      steps: [
        { icon: "shield", text: "Generando la carátula legal…" },
        { icon: "doc", text: "Ensamblando y ordenando los documentos…" },
        { icon: "clip", text: "Agregando los anexos…" },
        { icon: "form", text: "Numerando las páginas…" },
        { icon: "check", text: "Compilando el PDF final…" },
      ],
      toc: [
        { title: "Carátula", page: 1 },
        { title: "Índice de contenidos", page: 2 },
        { title: "Formulario I-589 (Parte A)", page: 3 },
        { title: "Memorándum de Miedo Creíble", page: 15 },
        { title: "Anexo A — Documentos de identidad", page: 266 },
        { title: "Anexo B — Soporte del caso", page: 278 },
        { title: "Tabla cronológica de hechos", page: 283 },
      ],
      anexos: [
        {
          group: "Fase 1 · Identidad y migratorio",
          items: [
            "Comprobante de domicilio — Karelis",
            "Pasaportes — Karelis, Alexander, Kamila y Amanda",
            "Cédulas de identidad — Karelis, Alexander, Kamila y Amanda",
            "Formularios I-94 — Karelis, Alexander, Kamila y Amanda",
            "Actas de nacimiento — Alexander, Kamila y Amanda",
          ],
        },
        {
          group: "Fase 2 · Soporte del caso",
          items: [
            "Certificación de partido político — Karelis",
            "Declaración jurada",
            "Informe médico",
            "Informe psicológico",
          ],
        },
      ],
    },
  },
};
