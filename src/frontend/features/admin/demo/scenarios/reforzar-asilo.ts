import type { DemoScenario } from "./types";

/**
 * Reforzar Asilo — escenario demo de "Yenifer" (clienta ficticia, El Salvador).
 *
 * Fase 2 del asilo vendida como servicio independiente (entry service, DOC-40
 * §3.1): la clienta YA presentó su I-589 ante USCIS y contrata el refuerzo —
 * declaración jurada, evidencias indexadas y Memorándum de Miedo Creíble.
 * Persona y entregables tomados del guion demo de la v1 (violencia de género
 * y de pandillas MS-13; declaración de 9 páginas, guion de 28 preguntas).
 * Todo es contenido inventado: ningún dato real, ningún PII. Servicio de una
 * sola fase (sin automation: el I-589 ya fue presentado por la clienta).
 */
export const reforzarAsilo: DemoScenario = {
  slug: "reforzar-asilo",
  service: { label: "Reforzar Asilo", icon: "shield", color: "gold" },
  client: {
    firstName: "Yenifer",
    parties: [{ name: "Yenifer", role: "applicant" }],
  },
  caseTitle: "Reforzar Asilo — Yenifer",
  phaseLabel: "Fase única · Reforzar",

  contract: {
    planLabel: "Reforzar Asilo · Con abogado",
    nextAmount: "$180",
    installments: [
      { label: "Cuota inicial (20%)", amount: "$180", due: "Hoy", isDownPayment: true },
      { label: "Cuota 2", amount: "$90", due: "5 ago" },
      { label: "Cuota 3", amount: "$90", due: "5 sep" },
      { label: "Cuota 4", amount: "$90", due: "5 oct" },
      { label: "Cuota 5", amount: "$90", due: "5 nov" },
      { label: "Cuota 6", amount: "$90", due: "5 dic" },
      { label: "Cuota 7", amount: "$90", due: "5 ene" },
      { label: "Cuota 8", amount: "$90", due: "5 feb" },
      { label: "Cuota 9", amount: "$90", due: "5 mar" },
    ],
    clauses: [
      {
        title: "1. Objeto del servicio",
        body: "UsaLatinoPrime reforzará la solicitud de asilo que la clienta ya presentó ante USCIS (Formulario I-589): preparación de su declaración jurada, organización e indexado de las evidencias de persecución y redacción del Memorándum de Miedo Creíble con jurisprudencia y condiciones del país.",
      },
      {
        title: "2. Honorarios y forma de pago",
        body: "El cliente acepta el plan de pagos detallado: una cuota inicial del 20% y ocho cuotas mensuales. El servicio se activa una vez confirmada la cuota inicial. Las tarifas oficiales de USCIS no están incluidas en estos honorarios.",
      },
      {
        title: "3. Alcance y responsabilidades",
        body: "Este servicio asume que el Formulario I-589 ya fue presentado ante USCIS; el refuerzo no constituye una nueva solicitud. El cliente se compromete a entregar documentación verídica y completa. Ninguna parte garantiza un resultado específico: la decisión final corresponde a la autoridad migratoria.",
      },
      {
        title: "4. Confidencialidad",
        body: "Toda la información compartida se trata de forma estrictamente confidencial y se utiliza únicamente para los fines del presente servicio legal.",
      },
    ],
  },

  captions: {
    cases:
      "Así ve Yenifer su caso de refuerzo recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma su contrato en segundos, directo desde el teléfono.",
    pagos: "Paga su cuota inicial del 20% de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
  },

  phases: [
    {
      slug: "principal",
      label: "Reforzar Asilo",

      documents: [
        {
          id: "i589-presentado",
          label: "I-589 presentado (completo)",
          hint: "Todas las páginas del formulario que ya presentaste.",
          category: "Caso presentado",
          extract: [
            { field: "Solicitante", value: "Yenifer Pacheco Morales" },
            { field: "Fecha de presentación", value: "12/09/2025" },
            { field: "N.º de recibo USCIS", value: "EAC-25-188-50432" },
            { field: "Base del asilo", value: "Grupo social particular" },
            { field: "Oficina de asilo", value: "Houston, Texas" },
          ],
        },
        {
          id: "declaracion-jurada",
          label: "Carta de declaración jurada ampliada",
          hint: "Tu historia en primera persona, si ya la tienes escrita.",
          category: "Caso presentado",
          extract: [
            { field: "Tipo", value: "Declaración jurada ampliada" },
            { field: "Páginas", value: "9" },
            { field: "Idioma", value: "Español" },
            { field: "Uso", value: "Narrativa primaria del memorándum" },
          ],
        },
        {
          id: "denuncia-policial",
          label: "Denuncia policial (PNC)",
          hint: "Denuncia o reporte presentado ante una autoridad.",
          category: "Evidencias de persecución",
          extract: [
            { field: "Autoridad", value: "Policía Nacional Civil — San Salvador" },
            { field: "Fecha", value: "03/11/2023" },
            { field: "Hecho denunciado", value: "Amenazas de muerte y extorsión" },
            { field: "Estado", value: "Sin resolución" },
          ],
        },
        {
          id: "reporte-medico",
          label: "Reporte médico de lesiones",
          hint: "Documenta lesiones o atención médica relacionada.",
          category: "Evidencias de persecución",
          extract: [
            { field: "Emitido por", value: "Hospital Nacional Rosales" },
            { field: "Fecha", value: "07/01/2024" },
            { field: "Hallazgos", value: "Contusiones compatibles con agresión" },
            { field: "Relación con el caso", value: "Consistente con el relato" },
          ],
        },
        {
          id: "reporte-psicologico",
          label: "Reporte psicológico",
          hint: "Evalúa el impacto emocional de la persecución.",
          category: "Evidencias de persecución",
          extract: [
            { field: "Tipo", value: "Evaluación psicológica" },
            { field: "Diagnóstico", value: "Estrés postraumático (TEPT)" },
            { field: "Evaluación", value: "Psicóloga clínica — Houston, TX" },
            { field: "Relación con el caso", value: "Secuelas de violencia de pandillas" },
          ],
        },
        {
          id: "capturas-amenazas",
          label: "Capturas de amenazas (WhatsApp y SMS)",
          hint: "Pantallazos legibles, con fecha y remitente.",
          category: "Evidencias de persecución",
          extract: [
            { field: "Mensajes", value: "14 capturas" },
            { field: "Período", value: "2023–2024" },
            { field: "Remitentes", value: "Números atribuidos a la MS-13" },
            { field: "Contenido", value: "Amenazas de muerte y cobro de renta" },
          ],
        },
        {
          id: "testigo-prensa",
          label: "Carta jurada de testigo + notas de prensa",
          hint: "Testimonios firmados y artículos sobre la violencia en tu zona.",
          category: "Condiciones del país",
          extract: [
            { field: "Testigo", value: "Vecina del barrio — firma notarizada" },
            { field: "Notas de prensa", value: "3 artículos (2023–2025)" },
            { field: "Tema", value: "Violencia de la MS-13 contra mujeres" },
            { field: "Fuentes", value: "Prensa salvadoreña e internacional" },
          ],
        },
      ],

      forms: [
        {
          id: "cuestionario-miedo-creible",
          label: "Cuestionario de Miedo Creíble",
          kind: "letter",
          progress: 100,
          caption: "Tu historia, módulo por módulo — alimenta el memorándum legal",
          sections: [
            {
              title: "Quién soy y de dónde vengo",
              items: [
                { q: "Nombre completo", a: "Yenifer Pacheco Morales" },
                { q: "País de origen", a: "El Salvador" },
                { q: "Ciudad", a: "San Salvador" },
                { q: "Ocupación", a: "Comerciante (puesto de venta propio)" },
              ],
            },
            {
              title: "Por qué me perseguían",
              items: [
                { q: "Motivo protegido", a: "Pertenencia a un grupo social particular" },
                {
                  q: "Descripción breve",
                  a: "Mujer salvadoreña, comerciante, víctima de extorsión y violencia de la pandilla MS-13 tras negarse a pagar 'renta'.",
                },
              ],
            },
            {
              title: "Lo que me pasó",
              items: [
                { q: "Primer incidente", a: "2021 — la clica local comienza a exigir 'renta' en su puesto de venta." },
                { q: "Peor incidente", a: "Enero 2024 — agresión física documentada en el reporte médico." },
                { q: "Último incidente", a: "Marzo 2024 — nueva amenaza de muerte por WhatsApp antes de huir." },
              ],
            },
            {
              title: "Intenté pedir ayuda",
              items: [
                { q: "¿Denunciaste?", a: "Sí, ante la PNC el 03/11/2023." },
                { q: "¿Hubo protección?", a: "No; la denuncia quedó sin resolución." },
              ],
            },
            {
              title: "Reubicación y temor futuro",
              items: [
                { q: "¿Podrías vivir en otra zona del país?", a: "No; la pandilla tiene presencia nacional." },
                { q: "¿Qué temes si regresas?", a: "Ser asesinada por haber denunciado y haber huido sin pagar." },
              ],
            },
          ],
        },
        {
          id: "cartas-testigos",
          label: "Cartas de Testigos",
          kind: "pdf",
          progress: 100,
          caption: "Datos de cada testigo para generar su declaración jurada",
          sections: [
            {
              title: "Testigo 1 — Vecina del barrio",
              items: [
                { q: "Relación con la solicitante", a: "Vecina y clienta del puesto de venta (12 años)" },
                { q: "Qué presenció", a: "Las visitas de cobro de la pandilla y el cierre forzado del negocio." },
                { q: "¿Firmará ante notario?", a: "Sí" },
              ],
            },
            {
              title: "Testigo 2 — Hermano de la solicitante",
              items: [
                { q: "Relación con la solicitante", a: "Hermano; vive en El Salvador" },
                { q: "Qué presenció", a: "Las amenazas telefónicas y la agresión de enero de 2024." },
                { q: "¿Firmará ante notario?", a: "Sí" },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "Sube su I-589 ya presentado y sus evidencias. El sistema sabe exactamente qué pedir.",
        formularios:
          "Su cuestionario de miedo creíble ya está completo al 100%, listo para revisar.",
        review:
          "Cada respuesta del cuestionario organizada por el sistema. Solo revisar y enviar.",
      },

      generation: {
        slotKey: "memo",
        title: "Memorándum de Miedo Creíble",
        caption: "Refuerzo legal del asilo ya presentado ante USCIS.",
        intro: "La IA redacta el memorándum legal a partir del I-589 presentado, el cuestionario, la jurisprudencia y las condiciones de El Salvador.",
        loaderTitle: "Generando el Memorándum de Miedo Creíble",
        previewTitle: "Memorándum de Miedo Creíble",
        snippet:
          "La solicitante presenta un temor fundado de persecución por su pertenencia a un grupo social particular —mujeres salvadoreñas víctimas de violencia de pandillas—, sustentado en la INA §208 y la jurisprudencia federal aplicable.",
        longSummary:
          "La solicitante, Yenifer Pacheco Morales, ciudadana salvadoreña, presentó su Formulario I-589 ante USCIS y refuerza ahora su caso con este memorándum. Tras años de extorsión, amenazas y agresiones de la pandilla MS-13 —denunciados ante la PNC sin protección efectiva—, huyó de El Salvador. El presente memorándum sustenta, con fundamento en la INA §208, la jurisprudencia federal y las condiciones actuales del país, que su temor de persecución por pertenecer a un grupo social particular es creíble y fundado.",
        indexTitle: "Índice del memorándum",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "41,286 palabras · 118 páginas · listo",
        downloadName: "memorandum-miedo-creible.pdf",
        splash: {
          title: "¡Memorándum generado!",
          body: "El memorándum de miedo creíble está listo para revisión.",
        },
        stats: [
          { value: "41,286", label: "palabras" },
          { value: "118", label: "páginas" },
          { value: "8", label: "precedentes" },
          { value: "12", label: "fuentes verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 41286 },
          { label: "páginas", value: 118 },
          { label: "citas verificadas", value: 20 },
        ],
        steps: [
          { icon: "doc", text: "Extrayendo del I-589 presentado…" },
          { icon: "search", text: "Leyendo el cuestionario de miedo creíble…" },
          { icon: "scale", text: "Analizando la jurisprudencia aplicable…" },
          { icon: "globe", text: "Revisando las condiciones de El Salvador…" },
          { icon: "edit", text: "Redactando las secciones legales…" },
          { icon: "shield", text: "Verificando citas y enlaces legales…" },
          { icon: "sparkle", text: "Ensamblando el memorándum…" },
        ],
        sections: [
          "I. Antecedentes de la solicitante",
          "II. Persecución sufrida (extorsión y violencia de la MS-13)",
          "III. Pertenencia a un grupo social particular",
          "IV. Ausencia de protección estatal efectiva",
          "V. Análisis legal (INA §208)",
          "VI. Condiciones del país — El Salvador",
          "VII. Conclusión y petición",
        ],
      },
    },
  ],

  staff: {
    caseNumber: "U26-000057",
    clientLegalName: "Yenifer Pacheco Morales",
    clientPhone: "+1 (713) 555-0186",
    planLabel: "Reforzar Asilo · Con abogado",
    statusLabel: "Activo",
    owner: { name: "Diana Torres", role: "Paralegal" },

    keyFacts: [
      { label: "Solicitante", value: "Yenifer Pacheco Morales" },
      { label: "País de origen", value: "El Salvador" },
      { label: "Base del caso", value: "Violencia de género y de pandillas (grupo social particular)" },
      { label: "I-589 presentado", value: "12 de septiembre de 2025" },
      { label: "Oficina de asilo", value: "Houston, Texas" },
      { label: "Estado del asilo", value: "A la espera de entrevista" },
    ],

    timeline: [
      { icon: "check", title: "Contrato firmado por la clienta", when: "Hace 5 días" },
      { icon: "dollar", title: "Cuota inicial confirmada — caso activo", when: "Hace 5 días" },
      { icon: "search", title: "I-589 presentado verificado por extracción IA", when: "Hace 4 días" },
      { icon: "upload", title: "7 documentos cargados y aprobados", when: "Hace 3 días" },
      { icon: "form", title: "Cuestionario de Miedo Creíble completado al 100%", when: "Hace 2 días" },
      { icon: "sparkle", title: "Memorándum de Miedo Creíble generado", when: "Ayer" },
      { icon: "shield", title: "Expediente reforzado listo para presentar", when: "Hoy" },
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
      title: "Expediente de refuerzo",
      caption: "Carátula, declaración jurada, memorándum y evidencias indexadas en un solo PDF.",
      intro: "El sistema arma el expediente de refuerzo completo: carátula, declaración jurada, memorándum y evidencias indexadas.",
      loaderTitle: "Compilando el expediente de refuerzo",
      toolbarNote: "Expediente reforzado y listo para presentar ante USCIS.",
      downloadName: "expediente-refuerzo.pdf",
      splash: {
        title: "¡Expediente compilado!",
        body: "El expediente reforzado está listo. Puedes revisarlo e imprimirlo.",
      },
      coverTitle: "EXPEDIENTE DE REFUERZO DE ASILO",
      coverSubtitle: "Declaración jurada · Memorándum de Miedo Creíble · Evidencias indexadas",
      coverRows: [
        { label: "Solicitante", value: "Yenifer Pacheco Morales" },
        { label: "País de origen", value: "El Salvador" },
        { label: "Servicio", value: "Reforzar Asilo (sobre I-589 ya presentado)" },
        { label: "Plan", value: "Reforzar Asilo · Con abogado" },
        { label: "Número de caso", value: "U26-000057" },
        { label: "Responsable", value: "Diana Torres · Paralegal" },
      ],
      chronology: [
        { when: "2021", event: "La clica local de la MS-13 comienza a exigirle “renta” en su puesto de venta en San Salvador." },
        { when: "Nov 2023", event: "Recibe amenazas de muerte por WhatsApp y SMS tras negarse a pagar; denuncia ante la PNC." },
        { when: "Ene 2024", event: "Sufre una agresión documentada en el reporte médico; la denuncia sigue sin resolución." },
        { when: "Mar 2024", event: "Huye de El Salvador con tránsito por Guatemala y México e ingresa a EE. UU." },
        { when: "Sep 2025", event: "Presenta su solicitud de asilo (Formulario I-589) ante USCIS." },
        { when: "2026", event: "Refuerza su caso: declaración jurada, evidencias indexadas y Memorándum de Miedo Creíble." },
      ],
      samplePages: { form: 3, generation: 18, anexos: 144, chronology: 179 },
      totalPages: 180,
      filedDoc: {
        docKicker: "Documento del cliente · Anexo",
        docPageTitle: "I-589 presentado (completo)",
        officialTitle: "Formulario I-589 · Solicitud de asilo presentada ante USCIS por la clienta",
        rows: [
          { label: "Solicitante", value: "Yenifer Pacheco Morales" },
          { label: "N.º de recibo USCIS", value: "EAC-25-188-50432" },
          { label: "Base del asilo", value: "Grupo social particular" },
          { label: "Oficina de asilo", value: "Houston, Texas" },
        ],
        note: "Documento presentado por la clienta ante USCIS; se anexa tal cual (no se genera en el sistema).",
      },
      steps: [
        { icon: "shield", text: "Generando la carátula legal…" },
        { icon: "doc", text: "Ensamblando y ordenando los documentos…" },
        { icon: "clip", text: "Indexando las evidencias…" },
        { icon: "form", text: "Numerando las páginas…" },
        { icon: "check", text: "Compilando el PDF final…" },
      ],
      toc: [
        { title: "Carátula", page: 1 },
        { title: "Índice de contenidos", page: 2 },
        { title: "I-589 presentado — anexo del cliente (completo)", page: 3 },
        { title: "Declaración Jurada (9 páginas)", page: 9 },
        { title: "Memorándum de Miedo Creíble", page: 18 },
        { title: "Guion de preparación — 28 preguntas modeladas", page: 136 },
        { title: "Anexo A — Evidencias de persecución", page: 144 },
        { title: "Anexo B — Condiciones del país", page: 168 },
        { title: "Tabla cronológica de hechos", page: 179 },
      ],
      anexos: [
        {
          group: "Caso presentado",
          items: [
            "I-589 presentado (completo) — Yenifer",
            "Carta de declaración jurada ampliada — 9 páginas",
          ],
        },
        {
          group: "Evidencias de persecución",
          items: [
            "Denuncia policial (PNC) — 03/11/2023",
            "Reporte médico de lesiones",
            "Reporte psicológico (TEPT)",
            "Capturas de amenazas — 14 mensajes",
            "Carta jurada de testigo (notarizada)",
          ],
        },
        {
          group: "Condiciones del país",
          items: [
            "Notas de prensa — violencia de la MS-13 (3 artículos)",
            "Informes de condiciones de El Salvador",
          ],
        },
      ],
    },
  },
};
