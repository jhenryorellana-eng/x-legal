import type { DemoScenario } from "./types";

/**
 * Apelación (BIA) — escenario demo de "Diego" (cliente ficticio, Honduras).
 *
 * Apelación ante la Junta de Apelaciones de Inmigración tras la denegación de
 * withholding y CAT por el Juez de Inmigración de Houston: Notice of Appeal
 * (EOIR-26) dentro del plazo de 30 días (8 C.F.R. §1003.38), Appeal Brief
 * generado con IA y exoneración de tarifa (EOIR-26A). Persona tomada del
 * guion demo de la v1. Todo es contenido inventado: ningún dato real.
 */
export const apelacion: DemoScenario = {
  slug: "apelacion",
  service: { label: "Apelación", icon: "scale", color: "red" },
  client: {
    firstName: "Diego",
    parties: [{ name: "Diego", role: "applicant" }],
  },
  caseTitle: "Apelación BIA — Diego",
  phaseLabel: "Fase única · Apelación",

  contract: {
    planLabel: "Apelación BIA · Con abogado",
    nextAmount: "$200",
    installments: [
      { label: "Cuota inicial", amount: "$200", due: "Hoy", isDownPayment: true },
      { label: "Cuota 2", amount: "$150", due: "5 ago" },
      { label: "Cuota 3", amount: "$150", due: "5 sep" },
    ],
    clauses: [
      {
        title: "1. Objeto del servicio",
        body: "UsaLatinoPrime preparará la apelación del cliente ante la Junta de Apelaciones de Inmigración (BIA): Formulario EOIR-26 (Notice of Appeal), escrito de apelación (Appeal Brief) y, de corresponder, la solicitud de exoneración de tarifa (Formulario EOIR-26A).",
      },
      {
        title: "2. Plazo crítico de 30 días",
        body: "La BIA debe RECIBIR el Notice of Appeal dentro de los 30 días calendario siguientes a la decisión del Juez de Inmigración (8 C.F.R. §1003.38). El cliente se compromete a entregar de inmediato la decisión del juez y todo documento del proceso.",
      },
      {
        title: "3. Honorarios y tarifas oficiales",
        body: "El cliente acepta el plan de pagos detallado: una cuota inicial y dos cuotas mensuales. La tarifa oficial de apelación de la BIA (aprox. $1,030) no está incluida; si el cliente no puede pagarla, se solicitará la exoneración mediante el Formulario EOIR-26A.",
      },
      {
        title: "4. Alcance y confidencialidad",
        body: "El cliente entregará información verídica y completa. Ninguna parte garantiza un resultado específico: la decisión corresponde a la BIA. Toda la información se trata de forma estrictamente confidencial.",
      },
    ],
  },

  documents: [
    {
      id: "decision-juez",
      label: "Decisión del Juez de Inmigración",
      hint: "La orden escrita que deniega tu caso — la IA calcula tu plazo.",
      category: "Caso ante la corte",
      extract: [
        { field: "Juez", value: "Hon. R. Whitaker" },
        { field: "Corte", value: "EOIR — Houston, Texas" },
        { field: "Decisión", value: "Denegación de withholding y CAT" },
        { field: "Fecha de decisión", value: "10/06/2026" },
        { field: "Plazo BIA", value: "30 días — vence 10/07/2026" },
      ],
    },
    {
      id: "paquete-asilo",
      label: "Paquete de asilo presentado (I-589 + evidencias)",
      hint: "La solicitud completa que presentaste ante la corte.",
      category: "Caso ante la corte",
      extract: [
        { field: "Formulario", value: "I-589 con evidencias" },
        { field: "Páginas", value: "212" },
        { field: "Presentado", value: "2024 — asilo defensivo" },
        { field: "Uso", value: "Base fáctica de la apelación" },
      ],
    },
    {
      id: "nta",
      label: "NTA — Notice to Appear",
      hint: "El documento que inició tu proceso en la corte.",
      category: "Caso ante la corte",
      extract: [
        { field: "Documento", value: "Formulario I-862 (NTA)" },
        { field: "N.º A (Alien Number)", value: "A-216-554-908" },
        { field: "Cargo", value: "INA §212(a)(6)(A)(i) — presencia sin admisión" },
        { field: "Emitido", value: "2023" },
      ],
    },
    {
      id: "pasaporte",
      label: "Pasaporte del apelante",
      hint: "Página de datos, nítida y completa.",
      category: "Identidad",
      extract: [
        { field: "Nombre", value: "Diego Ramírez Salinas" },
        { field: "N.º de pasaporte", value: "E-889041127" },
        { field: "Nacionalidad", value: "Hondureña" },
        { field: "Fecha de nacimiento", value: "23/08/1987" },
        { field: "Vencimiento", value: "15/02/2031" },
      ],
    },
    {
      id: "evidencia-financiera",
      label: "Evidencia financiera para exoneración de tarifa",
      hint: "Talones de pago, beneficios y estados de cuenta.",
      category: "Exoneración de tarifa",
      extract: [
        { field: "Talones de pago", value: "3 (últimos meses)" },
        { field: "Beneficios", value: "SNAP — constancia activa" },
        { field: "Saldo bancario", value: "$214.60" },
        { field: "Uso", value: "Formulario EOIR-26A (fee waiver)" },
      ],
    },
  ],

  forms: [
    {
      id: "eoir-26",
      label: "EOIR-26 — Notice of Appeal",
      kind: "pdf",
      progress: 100,
      caption: "Apelación ante la Junta de Apelaciones de Inmigración (BIA)",
      sections: [
        {
          title: "Datos del apelante",
          items: [
            { q: "Nombre completo", a: "Diego Ramírez Salinas" },
            { q: "Número A (Alien Number)", a: "A-216-554-908" },
            { q: "¿Está detenido?", a: "No" },
          ],
        },
        {
          title: "Decisión apelada",
          items: [
            { q: "¿Qué se apela?", a: "Decisión del Juez de Inmigración" },
            { q: "Fecha de la decisión", a: "10 de junio de 2026" },
            { q: "Corte", a: "EOIR — Houston, Texas" },
            { q: "Alivios denegados", a: "Withholding of removal y protección CAT" },
          ],
        },
        {
          title: "Motivos de la apelación",
          items: [
            {
              q: "Resumen de los motivos",
              a: "El Juez erró al valorar la credibilidad y la evidencia de tortura; el brief detallará los errores de hecho y de derecho.",
            },
            { q: "¿Presentará brief por separado?", a: "Sí" },
            { q: "¿Solicita argumento oral?", a: "No" },
          ],
        },
        {
          title: "Representación",
          items: [
            {
              q: "¿Tiene abogado ante la BIA?",
              a: "No — apelante pro se (UsaLatinoPrime prepara los escritos).",
            },
          ],
        },
        {
          title: "Entrega al DHS (Proof of Service)",
          items: [
            { q: "¿Copia entregada al DHS-ICE?", a: "Sí — constancia adjunta." },
            { q: "Fecha de entrega", a: "Dentro del plazo de 30 días." },
          ],
        },
      ],
    },
    {
      id: "eoir-26a",
      label: "EOIR-26A — Exoneración de tarifa",
      kind: "letter",
      progress: 100,
      caption: "Solicitud de exención de la tarifa de apelación ($1,030)",
      sections: [
        {
          title: "Identificación",
          items: [
            { q: "Nombre completo", a: "Diego Ramírez Salinas" },
            { q: "Número A (Alien Number)", a: "A-216-554-908" },
          ],
        },
        {
          title: "Ingresos mensuales",
          items: [
            { q: "Salario", a: "$1,480 (empleo de tiempo parcial)" },
            { q: "Otros ingresos", a: "Ninguno" },
          ],
        },
        {
          title: "Gastos mensuales",
          items: [
            { q: "Renta", a: "$950" },
            { q: "Alimentación y transporte", a: "$460" },
            { q: "Dependientes", a: "2 hijos" },
          ],
        },
        {
          title: "Declaración",
          items: [
            {
              q: "¿La información es verídica?",
              a: "Sí, declarada bajo pena de perjurio; no puede pagar la tarifa de $1,030.",
            },
          ],
        },
      ],
    },
  ],

  captions: {
    cases:
      "Así ve Diego su caso de apelación recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma su contrato en segundos. El reloj de los 30 días ya corre.",
    pagos: "Paga su cuota inicial de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
    documentos:
      "Sube la decisión del juez y su expediente. La IA calcula el plazo de la BIA automáticamente.",
    formularios:
      "Su EOIR-26 y la exoneración de tarifa ya están completos al 100%, listos para revisar.",
    review:
      "Cada respuesta del EOIR-26 organizada por el sistema. Solo revisar y enviar.",
  },

  staff: {
    caseNumber: "ULP-2026-0061",
    clientLegalName: "Diego Ramírez Salinas",
    clientPhone: "+1 (832) 555-0164",
    planLabel: "Apelación BIA · Con abogado",
    statusLabel: "Activo",
    owner: { name: "Diana Torres", role: "Paralegal" },

    keyFacts: [
      { label: "Apelante", value: "Diego Ramírez Salinas" },
      { label: "País de origen", value: "Honduras" },
      { label: "Corte", value: "EOIR — Houston, Texas" },
      { label: "Decisión apelada", value: "Denegación de withholding y CAT (10/06/2026)" },
      { label: "Plazo BIA", value: "30 días — vence 10/07/2026" },
      { label: "Tarifa de apelación", value: "EOIR-26A (exoneración) en trámite" },
    ],

    timeline: [
      { icon: "check", title: "Contrato firmado por el cliente", when: "Hace 4 días" },
      { icon: "dollar", title: "Cuota inicial confirmada — caso activo", when: "Hace 4 días" },
      { icon: "clock", title: "Decisión del juez extraída — plazo BIA: vence 10/07/2026", when: "Hace 3 días" },
      { icon: "upload", title: "5 documentos cargados y aprobados", when: "Hace 2 días" },
      { icon: "form", title: "Formulario EOIR-26 completado al 100%", when: "Ayer" },
      { icon: "scale", title: "Carta de Apelación generada — lista para revisión", when: "Hoy" },
    ],

    docsApproved: 5,
    docsTotal: 5,
    formsDone: 2,
    formsTotal: 2,

    translateSteps: [
      { icon: "sparkle", text: "Analizando el documento con IA…" },
      { icon: "search", text: "Extrayendo la información clave…" },
      { icon: "doc", text: "Leyendo el texto del documento (OCR)…" },
      { icon: "globe", text: "Traduciendo al inglés…" },
      { icon: "check", text: "Certificando la traducción…" },
    ],

    automation: {
      slotKey: "eoir26",
      title: "Formulario EOIR-26",
      officialTitle:
        "Formulario EOIR-26 · Notice of Appeal from a Decision of an Immigration Judge (DOJ — EOIR)",
      intro: "El sistema llena el Notice of Appeal oficial de la BIA a partir de la decisión del juez y las respuestas del apelante.",
      loaderTitle: "Ensamblando el Formulario EOIR-26",
      sourcePanelLabel: "Formulario de Diego",
      targetPanelLabel: "EOIR-26 oficial · BIA",
      filledChipLabel: "11 campos vacíos → N/A",
      fillNote: "La BIA debe recibir el Notice of Appeal dentro de los 30 días de la decisión (8 C.F.R. §1003.38); 11 campos sin dato se completaron con “N/A”.",
      previewTitle: "Formulario EOIR-26 — PDF oficial",
      doneMeta: "4 págs · PDF oficial · 11 campos en N/A",
      docKicker: "Formulario oficial · DOJ EOIR",
      docPageTitle: "Formulario EOIR-26 — Notice of Appeal",
      downloadName: "eoir-26.pdf",
      splash: {
        title: "¡Notice of Appeal generado!",
        body: "El Formulario EOIR-26 quedó completo, dentro del plazo de 30 días.",
      },
      steps: [
        { icon: "form", text: "Leyendo la decisión del juez…" },
        { icon: "doc", text: "Abriendo el PDF oficial EOIR-26 (BIA)…" },
        { icon: "clock", text: "Verificando el plazo de 30 días…" },
        { icon: "bolt", text: "Mapeando cada dato a su campo oficial…" },
        { icon: "check", text: "Generando el PDF final…" },
      ],
      fields: [
        { plain: "Nombre del apelante", official: "Parte A — Name of Appellant", fieldName: "AppellantName", value: "Ramírez Salinas, Diego" },
        { plain: "Número A (Alien Number)", official: "Parte A — A-Number", fieldName: "ANumber", value: "A-216-554-908" },
        { plain: "¿Está detenido?", official: "Parte A — Detained", fieldName: "DetainedCheckbox", value: "No" },
        { plain: "Tipo de apelación", official: "Parte B — Appeal from IJ decision", fieldName: "AppealTypeIJ", value: "Immigration Judge decision" },
        { plain: "Fecha de la decisión", official: "Parte C — Date of IJ decision", fieldName: "IJDecisionDate", value: "06/10/2026" },
        { plain: "Corte de inmigración", official: "Parte C — Immigration Court", fieldName: "ImmigrationCourt", value: "Houston, TX" },
        { plain: "Motivos de la apelación", official: "Parte D — Reasons for appeal", fieldName: "ReasonsForAppeal", value: "Errores de hecho y de derecho (credibilidad, CAT)" },
        { plain: "¿Presentará brief?", official: "Parte E — Separate written brief", fieldName: "WillFileBrief", value: "Yes" },
        { plain: "¿Argumento oral?", official: "Parte E — Oral argument", fieldName: "OralArgument", value: "No" },
        { plain: "Abogado ante la BIA", official: "Parte F — Attorney / Representative", fieldName: "AttorneyName", value: null },
        { plain: "Entrega al DHS (Proof of Service)", official: "Parte G — Proof of Service", fieldName: "ProofOfService", value: "DHS-ICE Office of Chief Counsel, Houston" },
      ],
    },

    generation: {
      slotKey: "brief",
      title: "Carta de Apelación (Appeal Brief)",
      caption: "Escrito legal ante la BIA — redactado en inglés.",
      intro: "La IA redacta el brief de apelación a partir de la decisión del juez, el expediente de asilo y los precedentes de la BIA y del Quinto Circuito.",
      loaderTitle: "Generando la Carta de Apelación",
      previewTitle: "Carta de Apelación (Appeal Brief)",
      snippet:
        "The Immigration Judge committed reversible errors of fact and law: the adverse credibility finding ignores corroborating evidence (REAL ID Act, INA §208(b)(1)(B)(iii)) and the CAT analysis disregards the record on government acquiescence (8 C.F.R. §§1208.16–18).",
      longSummary:
        "El apelante, Diego Ramírez Salinas, apela la decisión del Juez de Inmigración de Houston que denegó su withholding of removal y la protección bajo la Convención contra la Tortura. El brief demuestra, punto por punto, que la determinación adversa de credibilidad ignoró evidencia corroborante (REAL ID Act, INA §208(b)(1)(B)(iii)) y que el análisis CAT omitió el estándar de aquiescencia estatal (8 C.F.R. §§1208.16–18), con apoyo en precedentes favorables de la BIA y del Quinto Circuito.",
      indexTitle: "Índice del brief",
      docKicker: "Generado con IA · Verificado",
      doneMeta: "2,340 palabras · 14 páginas · listo",
      downloadName: "appeal-brief.pdf",
      splash: {
        title: "¡Carta de Apelación generada!",
        body: "El brief ante la BIA está listo para revisión legal.",
      },
      stats: [
        { value: "2,340", label: "palabras" },
        { value: "14", label: "páginas" },
        { value: "9", label: "precedentes" },
        { value: "6", label: "fuentes verificadas" },
      ],
      loaderCounters: [
        { label: "palabras", value: 2340 },
        { label: "páginas", value: 14 },
        { label: "citas verificadas", value: 15 },
      ],
      steps: [
        { icon: "doc", text: "Extrayendo la decisión del juez…" },
        { icon: "search", text: "Revisando el expediente de asilo…" },
        { icon: "scale", text: "Buscando precedentes de la BIA y del 5.º Circuito…" },
        { icon: "edit", text: "Redactando las 8 secciones del brief…" },
        { icon: "shield", text: "Verificando citas legales…" },
        { icon: "sparkle", text: "Ensamblando el brief final…" },
      ],
      sections: [
        "I. Procedural Summary",
        "II. Legal & Factual Errors in the IJ's Decision",
        "III. Credibility Analysis (REAL ID Act)",
        "IV. Convention Against Torture (CAT)",
        "V. Safe Third Country / Firm Resettlement",
        "VI. Favorable BIA & Fifth Circuit Precedents",
        "VII. Winning Arguments",
        "VIII. Conclusion & Prayer for Relief",
      ],
    },

    expediente: {
      slotKey: "expediente",
      title: "Paquete de apelación",
      caption: "EOIR-26, brief, exoneración de tarifa y anexos en un solo PDF.",
      intro: "El sistema arma el paquete de apelación completo: EOIR-26, brief, EOIR-26A y anexos, listo para la BIA.",
      loaderTitle: "Compilando el paquete de apelación",
      toolbarNote: "Paquete de apelación listo para presentar ante la BIA.",
      downloadName: "paquete-apelacion.pdf",
      splash: {
        title: "¡Paquete compilado!",
        body: "El paquete de apelación está listo. Puedes revisarlo e imprimirlo.",
      },
      coverTitle: "PAQUETE DE APELACIÓN — BIA",
      coverSubtitle: "Notice of Appeal (EOIR-26) · Appeal Brief · Fee Waiver (EOIR-26A)",
      coverRows: [
        { label: "Apelante", value: "Diego Ramírez Salinas" },
        { label: "País de origen", value: "Honduras" },
        { label: "Servicio", value: "Apelación ante la BIA (EOIR-26)" },
        { label: "Plan", value: "Apelación BIA · Con abogado" },
        { label: "Número de caso", value: "ULP-2026-0061" },
        { label: "Responsable", value: "Diana Torres · Paralegal" },
      ],
      chronology: [
        { when: "2023", event: "Recibe el NTA (I-862) y comienza su proceso ante la corte de inmigración de Houston." },
        { when: "2024", event: "Presenta su solicitud de asilo defensivo (I-589) con evidencias ante la corte." },
        { when: "Mar 2026", event: "Audiencia individual: testimonio y presentación de pruebas." },
        { when: "10 Jun 2026", event: "El Juez de Inmigración deniega withholding of removal y la protección CAT." },
        { when: "Jun 2026", event: "La IA extrae la decisión y calcula el plazo: la BIA debe recibir el EOIR-26 antes del 10/07/2026." },
        { when: "Hoy", event: "Paquete de apelación compilado: EOIR-26, brief y exoneración de tarifa listos para presentar." },
      ],
      samplePages: { form: 3, generation: 7, anexos: 28, chronology: 62 },
      totalPages: 64,
      steps: [
        { icon: "scale", text: "Generando la carátula legal…" },
        { icon: "doc", text: "Ensamblando EOIR-26, brief y EOIR-26A…" },
        { icon: "clip", text: "Agregando la decisión del juez y anexos…" },
        { icon: "form", text: "Numerando las páginas…" },
        { icon: "check", text: "Compilando el PDF final…" },
      ],
      toc: [
        { title: "Carátula", page: 1 },
        { title: "Índice de contenidos", page: 2 },
        { title: "Formulario EOIR-26 (Notice of Appeal)", page: 3 },
        { title: "Carta de Apelación (Appeal Brief)", page: 7 },
        { title: "EOIR-26A + Carta de Exoneración", page: 21 },
        { title: "Proof of Service (DHS-ICE)", page: 26 },
        { title: "Anexo A — Decisión del Juez de Inmigración", page: 28 },
        { title: "Anexo B — Expediente de asilo presentado", page: 41 },
        { title: "Tabla cronológica del proceso", page: 62 },
      ],
      anexos: [
        {
          group: "Apelación",
          items: [
            "Formulario EOIR-26 — Notice of Appeal",
            "Carta de Apelación (Appeal Brief) — 14 páginas",
            "EOIR-26A + Carta de Exoneración",
            "Proof of Service — DHS-ICE Houston",
          ],
        },
        {
          group: "Soporte del caso",
          items: [
            "Decisión del Juez de Inmigración — 10/06/2026",
            "Paquete de asilo presentado (I-589 + evidencias)",
            "Pasaporte del apelante",
            "NTA — Notice to Appear (I-862)",
            "Evidencia financiera (exoneración de tarifa)",
          ],
        },
      ],
    },
  },
};
