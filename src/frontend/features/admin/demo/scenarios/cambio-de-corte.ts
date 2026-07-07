import type { DemoScenario } from "./types";

/**
 * Cambio de Corte (Change of Venue) — escenario demo de "Andrés" (cliente
 * ficticio, Venezuela).
 *
 * Moción de Cambio de Sede (Motion to Change Venue, 8 C.F.R. §1003.20) ante la
 * Corte de Inmigración de El Paso: el respondente se mudó a Columbus, Ohio y
 * pide trasladar su caso de asilo a la Corte de Inmigración de Cleveland (la
 * competente para Ohio). El sistema llena el Formulario EOIR-33 oficial y la IA
 * —tras determinar la corte competente por la nueva dirección— redacta la
 * moción con su Certificate of Service al Office of Chief Counsel. Datos de las
 * cortes tomados del catálogo curado de 74 cortes EOIR de la v1. Todo es
 * contenido inventado: ningún dato real, ningún PII. Servicio de una sola fase.
 */
export const cambioDeCorte: DemoScenario = {
  slug: "cambio-de-corte",
  service: { label: "Cambio de Corte", icon: "route", color: "navy" },
  client: {
    firstName: "Andrés",
    parties: [{ name: "Andrés", role: "applicant" }],
  },
  caseTitle: "Cambio de Corte — Andrés",
  phaseLabel: "Fase única · Cambio de Corte",

  contract: {
    planLabel: "Cambio de Corte · Con abogado",
    nextAmount: "$100",
    installments: [
      { label: "Cuota inicial", amount: "$100", due: "Hoy", isDownPayment: true },
      { label: "Cuota 2", amount: "$50", due: "5 ago" },
      { label: "Cuota 3", amount: "$50", due: "5 sep" },
      { label: "Cuota 4", amount: "$50", due: "5 oct" },
    ],
    clauses: [
      {
        title: "1. Objeto del servicio",
        body: "UsaLatinoPrime preparará la solicitud de Cambio de Sede (Change of Venue) del cliente ante la Corte de Inmigración: el Formulario EOIR-33 (cambio de dirección) y la Moción de Cambio de Sede (Motion to Change Venue) dirigida a la corte actual, con su Certificate of Service al Office of Chief Counsel.",
      },
      {
        title: "2. Buena causa y discrecionalidad del juez",
        body: "El cambio de sede se concede por “buena causa” (good cause) y queda a discreción del Juez de Inmigración (8 C.F.R. §1003.20). El cliente se compromete a demostrar una mudanza genuina y a entregar el aviso de la corte actual (NTA) y la prueba de su nueva dirección.",
      },
      {
        title: "3. Honorarios y tarifas oficiales",
        body: "El cliente acepta el plan de pagos detallado: una cuota inicial y tres cuotas mensuales. La moción de cambio de sede ante la Corte de Inmigración no tiene tarifa oficial (filing fee $0); los honorarios cubren únicamente la preparación y presentación de los escritos.",
      },
      {
        title: "4. Alcance y confidencialidad",
        body: "El cliente entregará información verídica y completa. Ninguna parte garantiza un resultado específico: la decisión corresponde al Juez de Inmigración. Tras la transferencia, la próxima audiencia se celebrará en la nueva corte. Toda la información se trata de forma estrictamente confidencial.",
      },
    ],
  },

  captions: {
    cases:
      "Así ve Andrés su caso de Cambio de Corte recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma su contrato en segundos. Su traslado de corte empieza a tramitarse.",
    pagos: "Paga su cuota inicial de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
  },

  phases: [
    {
      slug: "principal",
      label: "Cambio de Corte",

      documents: [
        {
          id: "id-foto",
          label: "Identificación con foto (pasaporte)",
          hint: "Página de datos, nítida y completa.",
          category: "Identidad",
          extract: [
            { field: "Nombre", value: "Andrés Villalba Suárez" },
            { field: "N.º de pasaporte", value: "V-104882375" },
            { field: "Nacionalidad", value: "Venezolana" },
            { field: "Fecha de nacimiento", value: "12/04/1990" },
            { field: "Vencimiento", value: "07/09/2030" },
          ],
        },
        {
          id: "nta",
          label: "NTA — Aviso de la corte actual (Notice to Appear)",
          hint: "El documento que inició tu proceso — la IA extrae tu corte y tu número A.",
          category: "Caso ante la corte",
          extract: [
            { field: "Documento", value: "Formulario I-862 (NTA)" },
            { field: "N.º A (Alien Number)", value: "A-231-887-045" },
            { field: "Corte actual", value: "EOIR — El Paso, Texas" },
            { field: "Juez", value: "Hon. C. Delgado" },
            { field: "Próxima audiencia", value: "Master Calendar — 18/09/2026" },
            { field: "Cargo", value: "INA §212(a)(6)(A)(i) — presencia sin admisión" },
          ],
        },
        {
          id: "prueba-direccion-anterior",
          label: "Comprobante de dirección anterior (El Paso)",
          hint: "Factura o contrato a tu nombre en tu domicilio anterior.",
          category: "Domicilio",
          extract: [
            { field: "Titular", value: "Andrés Villalba Suárez" },
            { field: "Dirección anterior", value: "3125 Pershing Dr, Apt 4" },
            { field: "Ciudad / Estado / ZIP", value: "El Paso, TX 79903" },
            { field: "Uso", value: "Domicilio ligado a la corte de El Paso" },
          ],
        },
        {
          id: "prueba-nueva-direccion",
          label: "Comprobante de nueva dirección (Ohio)",
          hint: "Contrato de renta o factura de tu nuevo domicilio — la IA determina tu nueva corte.",
          category: "Domicilio",
          extract: [
            { field: "Titular", value: "Andrés Villalba Suárez" },
            { field: "Nueva dirección", value: "4820 Cleveland Ave, Apt 12" },
            { field: "Ciudad / Estado / ZIP", value: "Columbus, OH 43231" },
            { field: "Corte competente (IA)", value: "Cleveland Immigration Court — cubre Ohio" },
          ],
        },
        {
          id: "i94",
          label: "Registro de entrada (I-94)",
          hint: "Tu registro de admisión o ingreso a EE. UU.",
          category: "Caso ante la corte",
          extract: [
            { field: "Documento", value: "I-94 — Arrival/Departure Record" },
            { field: "Fecha de entrada", value: "2023" },
            { field: "Clase de admisión", value: "Presencia sin admisión (EWI)" },
            { field: "Uso", value: "Contexto del proceso ante la corte" },
          ],
        },
      ],

      forms: [
        {
          id: "eoir-33",
          label: "EOIR-33 — Cambio de dirección / sede",
          kind: "pdf",
          progress: 100,
          caption: "Formulario oficial que notifica la nueva dirección a la Corte de Inmigración",
          sections: [
            {
              title: "Datos del extranjero",
              items: [
                { q: "Nombre completo", a: "Andrés Villalba Suárez" },
                { q: "Número A (Alien Number)", a: "A-231-887-045" },
                { q: "Teléfono", a: "(614) 555-0176" },
              ],
            },
            {
              title: "Nueva dirección",
              items: [
                { q: "Calle y unidad", a: "4820 Cleveland Ave, Apt 12" },
                { q: "Ciudad, estado y ZIP", a: "Columbus, OH 43231" },
                { q: "¿Ya se mudó?", a: "Sí — reside en Ohio desde julio de 2026." },
              ],
            },
            {
              title: "Corte actual y solicitada",
              items: [
                { q: "Corte actual", a: "El Paso Immigration Court (TX)" },
                { q: "Corte solicitada", a: "Cleveland Immigration Court (OH)" },
                { q: "Idioma / intérprete", a: "Español" },
              ],
            },
            {
              title: "Entrega al DHS (Proof of Service)",
              items: [
                { q: "¿Copia entregada al DHS-ICE?", a: "Sí — Office of Chief Counsel, El Paso." },
                { q: "Fecha de entrega", a: "El mismo día de la presentación." },
              ],
            },
          ],
        },
        {
          id: "datos-mocion",
          label: "Datos para la Moción de Cambio de Corte",
          kind: "letter",
          progress: 100,
          caption: "Motivos del traslado que la IA convierte en la Motion to Change Venue",
          sections: [
            {
              title: "Motivo del cambio",
              items: [
                { q: "Categoría", a: "Mudanza genuina de residencia" },
                {
                  q: "Explicación",
                  a: "El respondente se mudó permanentemente de El Paso (TX) a Columbus (OH) por trabajo estable; asistir a la corte de El Paso implica ~2,600 km de distancia.",
                },
              ],
            },
            {
              title: "Dificultad (hardship)",
              items: [
                {
                  q: "¿Por qué es difícil asistir a la corte actual?",
                  a: "El costo del viaje y la ausencia laboral tornan impracticable comparecer en El Paso; no cuenta con medios para viajar repetidamente.",
                },
              ],
            },
            {
              title: "Lazos con la nueva ubicación",
              items: [
                { q: "Empleo", a: "Empleo a tiempo completo en Columbus, OH." },
                { q: "Residencia", a: "Contrato de renta vigente a su nombre en Columbus." },
                { q: "¿Se opone el gobierno?", a: "No consta oposición del DHS." },
              ],
            },
          ],
        },
      ],

      captions: {
        documentos:
          "Sube el aviso de tu corte actual y la prueba de tu nueva dirección. La IA determina la corte competente automáticamente.",
        formularios:
          "Su EOIR-33 y los datos de la moción ya están completos al 100%, listos para revisar.",
        review:
          "Cada respuesta del EOIR-33 organizada por el sistema. Solo revisar y enviar.",
      },

      automation: {
        slotKey: "eoir33",
        title: "Formulario EOIR-33",
        officialTitle:
          "Formulario EOIR-33/IC · Alien's Change of Address / Change of Venue (DOJ — EOIR)",
        intro: "El sistema llena el EOIR-33 oficial con la nueva dirección del solicitante y la corte a la que se solicita el traslado.",
        loaderTitle: "Ensamblando el Formulario EOIR-33",
        sourcePanelLabel: "Formulario de Andrés",
        targetPanelLabel: "EOIR-33 oficial · DOJ EOIR",
        filledChipLabel: "9 campos vacíos → N/A",
        fillNote: "El extranjero debe notificar a la corte cualquier cambio de dirección dentro de 5 días hábiles (8 C.F.R. §1003.15(d)); 9 campos sin dato se completaron con “N/A”.",
        previewTitle: "Formulario EOIR-33 — PDF oficial",
        doneMeta: "2 págs · PDF oficial · 9 campos en N/A",
        docKicker: "Formulario oficial · DOJ EOIR",
        docPageTitle: "Formulario EOIR-33 — Cambio de dirección / sede",
        downloadName: "eoir-33.pdf",
        splash: {
          title: "¡EOIR-33 generado!",
          body: "El formulario de cambio de dirección quedó completo, listo para la corte.",
        },
        steps: [
          { icon: "form", text: "Leyendo los datos del solicitante…" },
          { icon: "doc", text: "Abriendo el PDF oficial EOIR-33 (DOJ EOIR)…" },
          { icon: "route", text: "Confirmando la corte solicitada (Cleveland)…" },
          { icon: "bolt", text: "Mapeando cada dato a su campo oficial…" },
          { icon: "check", text: "Generando el PDF final…" },
        ],
        fields: [
          { plain: "Nombre del extranjero", official: "Alien's Name", fieldName: "AlienName", value: "Villalba Suárez, Andrés" },
          { plain: "Número A (Alien Number)", official: "A-Number", fieldName: "ANumber", value: "A-231-887-045" },
          { plain: "Nueva dirección (calle)", official: "New Address — Street", fieldName: "NewAddressStreet", value: "4820 Cleveland Ave, Apt 12" },
          { plain: "Ciudad, estado y ZIP", official: "New Address — City/State/ZIP", fieldName: "NewAddressCityStateZip", value: "Columbus, OH 43231" },
          { plain: "Teléfono", official: "Telephone Number", fieldName: "Telephone", value: "(614) 555-0176" },
          { plain: "Corte actual", official: "Current Immigration Court", fieldName: "CurrentCourt", value: "El Paso, TX" },
          { plain: "Corte solicitada (traslado)", official: "Requested Immigration Court", fieldName: "RequestedCourt", value: "Cleveland, OH" },
          { plain: "Idioma / intérprete", official: "Language for Hearing", fieldName: "HearingLanguage", value: "Spanish" },
          { plain: "Abogado / representante", official: "Attorney / Representative", fieldName: "AttorneyName", value: null },
          { plain: "Firma del extranjero", official: "Signature of Alien", fieldName: "AlienSignature", value: null },
        ],
      },

      generation: {
        slotKey: "mocion",
        title: "Moción de Cambio de Corte (Motion to Change Venue)",
        caption: "Escrito legal ante la Corte de Inmigración — redactado en inglés.",
        intro: "La IA determina la corte competente por la nueva dirección (catálogo de 74 cortes EOIR) y redacta la moción de cambio de sede con su Certificate of Service al Office of Chief Counsel.",
        loaderTitle: "Generando la Moción de Cambio de Corte",
        previewTitle: "Moción de Cambio de Corte (Motion to Change Venue)",
        snippet:
          "Respondent, ANDRÉS VILLALBA SUÁREZ (A# 231-887-045), respectfully moves this Honorable Court, pursuant to 8 C.F.R. §1003.20, to change venue from the El Paso Immigration Court to the Cleveland Immigration Court. Good cause exists: Respondent has permanently relocated his residence to Columbus, Ohio, which lies within the jurisdiction of the Cleveland Immigration Court.",
        longSummary:
          "El solicitante, Andrés Villalba Suárez, pide trasladar su proceso de la Corte de Inmigración de El Paso (TX) a la de Cleveland (OH). La IA determinó, a partir de su nueva dirección en Columbus, Ohio, que la corte competente es Cleveland, y redactó la moción demostrando “buena causa” bajo 8 C.F.R. §1003.20 (mudanza genuina, empleo y residencia en Ohio, dificultad para comparecer en El Paso), con su Certificate of Service al Office of Chief Counsel (OPLA) de El Paso.",
        indexTitle: "Índice de la moción",
        docKicker: "Generado con IA · Verificado",
        doneMeta: "1,180 palabras · 6 páginas · listo",
        downloadName: "mocion-cambio-corte.pdf",
        splash: {
          title: "¡Moción de Cambio de Corte generada!",
          body: "La Motion to Change Venue está lista para revisión legal.",
        },
        stats: [
          { value: "1,180", label: "palabras" },
          { value: "6", label: "páginas" },
          { value: "74", label: "cortes analizadas" },
          { value: "3", label: "citas verificadas" },
        ],
        loaderCounters: [
          { label: "palabras", value: 1180 },
          { label: "páginas", value: 6 },
          { label: "cortes analizadas", value: 74 },
        ],
        steps: [
          { icon: "search", text: "Analizando la nueva dirección (Columbus, OH)…" },
          { icon: "route", text: "Determinando la corte EOIR competente (catálogo de 74 cortes)…" },
          { icon: "scale", text: "Redactando la moción de buena causa (8 C.F.R. §1003.20)…" },
          { icon: "doc", text: "Generando el Certificate of Service al Office of Chief Counsel…" },
          { icon: "shield", text: "Verificando citas legales y direcciones de la corte…" },
          { icon: "sparkle", text: "Ensamblando la moción final…" },
        ],
        sections: [
          "I. Jurisdiction & Introduction",
          "II. Statement of Facts",
          "III. Good Cause for Change of Venue (8 C.F.R. §1003.20)",
          "IV. Prayer for Relief",
          "V. Certificate of Service",
        ],
      },
    },
  ],

  staff: {
    caseNumber: "ULP-2026-0078",
    clientLegalName: "Andrés Villalba Suárez",
    clientPhone: "+1 (614) 555-0176",
    planLabel: "Cambio de Corte · Con abogado",
    statusLabel: "Activo",
    owner: { name: "Diana Torres", role: "Paralegal" },

    keyFacts: [
      { label: "Solicitante", value: "Andrés Villalba Suárez" },
      { label: "País de origen", value: "Venezuela" },
      { label: "Corte actual", value: "El Paso Immigration Court (TX)" },
      { label: "Nueva residencia", value: "Columbus, Ohio" },
      { label: "Corte solicitada", value: "Cleveland Immigration Court (OH)" },
      { label: "Fundamento", value: "Buena causa — mudanza genuina (8 C.F.R. §1003.20)" },
    ],

    timeline: [
      { icon: "check", title: "Contrato firmado por el cliente", when: "Hace 4 días" },
      { icon: "dollar", title: "Cuota inicial confirmada — caso activo", when: "Hace 4 días" },
      { icon: "route", title: "Nueva dirección extraída — corte competente: Cleveland (OH)", when: "Hace 3 días" },
      { icon: "upload", title: "5 documentos cargados y aprobados", when: "Hace 2 días" },
      { icon: "form", title: "Formulario EOIR-33 completado al 100%", when: "Ayer" },
      { icon: "scale", title: "Moción de Cambio de Corte generada — lista para revisión", when: "Hoy" },
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

    expediente: {
      slotKey: "expediente",
      title: "Paquete de cambio de corte",
      caption: "EOIR-33, la moción, el Certificate of Service y los anexos en un solo PDF.",
      intro: "El sistema arma el paquete completo de cambio de sede: EOIR-33, la Motion to Change Venue, el Certificate of Service y los anexos de soporte, listo para presentar ante la corte actual.",
      loaderTitle: "Compilando el paquete de cambio de corte",
      toolbarNote: "Paquete de cambio de sede listo para presentar ante la Corte de El Paso.",
      downloadName: "paquete-cambio-corte.pdf",
      splash: {
        title: "¡Paquete compilado!",
        body: "El paquete de cambio de corte está listo. Puedes revisarlo e imprimirlo.",
      },
      coverTitle: "PAQUETE DE CAMBIO DE CORTE",
      coverSubtitle: "Formulario EOIR-33 · Motion to Change Venue · Certificate of Service",
      coverRows: [
        { label: "Solicitante", value: "Andrés Villalba Suárez" },
        { label: "País de origen", value: "Venezuela" },
        { label: "Servicio", value: "Cambio de Corte (EOIR-33 + Moción)" },
        { label: "Traslado", value: "El Paso, TX → Cleveland, OH" },
        { label: "Número de caso", value: "ULP-2026-0078" },
        { label: "Responsable", value: "Diana Torres · Paralegal" },
      ],
      chronology: [
        { when: "2023", event: "Recibe el NTA (I-862) e inicia su proceso ante la Corte de Inmigración de El Paso, Texas." },
        { when: "2024–2025", event: "Comparece a audiencias Master Calendar en El Paso mientras reside en Texas." },
        { when: "Jul 2026", event: "Se muda permanentemente a Columbus, Ohio, por un empleo estable." },
        { when: "Jul 2026", event: "La IA extrae la nueva dirección y determina que la corte competente para Ohio es Cleveland." },
        { when: "Jul 2026", event: "Se prepara el EOIR-33 y la moción de cambio de sede (8 C.F.R. §1003.20), con Certificate of Service al OPLA de El Paso." },
        { when: "Hoy", event: "Paquete de cambio de corte compilado: EOIR-33, moción y Certificate of Service listos para presentar." },
      ],
      samplePages: { form: 3, generation: 5, anexos: 12, chronology: 22 },
      totalPages: 24,
      steps: [
        { icon: "scale", text: "Generando la carátula legal…" },
        { icon: "doc", text: "Ensamblando EOIR-33 y la moción…" },
        { icon: "clip", text: "Agregando el NTA, comprobantes de dirección y anexos…" },
        { icon: "form", text: "Numerando las páginas…" },
        { icon: "check", text: "Compilando el PDF final…" },
      ],
      toc: [
        { title: "Carátula", page: 1 },
        { title: "Índice de contenidos", page: 2 },
        { title: "Formulario EOIR-33 (cambio de dirección)", page: 3 },
        { title: "Motion to Change Venue", page: 5 },
        { title: "Certificate of Service (OPLA El Paso)", page: 11 },
        { title: "Anexo A — NTA (Notice to Appear)", page: 12 },
        { title: "Anexo B — Comprobante de nueva dirección (Ohio)", page: 15 },
        { title: "Anexo C — Comprobante de dirección anterior (El Paso)", page: 18 },
        { title: "Anexo D — Identificación y I-94", page: 20 },
        { title: "Tabla cronológica del proceso", page: 22 },
      ],
      anexos: [
        {
          group: "Cambio de corte",
          items: [
            "Formulario EOIR-33 — Cambio de dirección / sede",
            "Motion to Change Venue — 6 páginas",
            "Certificate of Service — DHS-ICE OPLA El Paso",
          ],
        },
        {
          group: "Soporte del caso",
          items: [
            "NTA — Notice to Appear (I-862)",
            "Comprobante de nueva dirección — Columbus, OH",
            "Comprobante de dirección anterior — El Paso, TX",
            "Pasaporte del solicitante",
            "Registro de entrada (I-94)",
          ],
        },
      ],
    },
  },
};
