import type { DemoScenario } from "./types";

/**
 * Asilo Político — escenario demo de "Karelis" (cliente ficticia, 3 hijos).
 *
 * Combina artefactos de fase 1 y fase 2 en un solo flujo simplificado para el
 * live. Todo es contenido inventado: ningún dato real, ningún PII. Los nombres
 * de los documentos están deliberadamente "combinados" (un renglón por tipo,
 * no por persona) porque así se pidió para el demo.
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

  documents: [
    {
      id: "passports",
      label: "Pasaportes de Karelis, Alexander, Kamila y Amanda",
      hint: "Página de datos, nítida y completa.",
      category: "Identidad",
    },
    {
      id: "ids",
      label: "Cédulas / documentos de identidad de Karelis, Alexander, Kamila y Amanda",
      hint: "Anverso y reverso.",
      category: "Identidad",
    },
    {
      id: "address",
      label: "Comprobante de domicilio",
      hint: "Recibo o carta a nombre de la solicitante.",
      category: "Domicilio",
    },
    {
      id: "i94",
      label: "Formularios I-94 de Karelis, Alexander, Kamila y Amanda",
      hint: "Registro de entrada/salida de EE. UU.",
      category: "Migratorio",
    },
    {
      id: "birth-certs",
      label: "Actas de nacimiento de Alexander, Kamila y Amanda + declaración jurada",
      hint: "Apostilladas si están disponibles.",
      category: "Familia",
    },
    {
      id: "medical",
      label: "Informe médico",
      hint: "Documenta condiciones físicas relevantes al caso.",
      category: "Soporte del caso",
    },
    {
      id: "psych",
      label: "Informe psicológico",
      hint: "Evalúa el impacto emocional de la persecución.",
      category: "Soporte del caso",
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
    cases:
      "Así ve Karelis su caso recién creado: dos pasos para activarlo — firmar y pagar.",
    signing: "Firma su contrato en segundos, directo desde el teléfono.",
    pagos: "Paga su primera cuota de forma segura. Sin filas, sin efectivo.",
    disclaimer: "Antes de entrar, acepta el aviso legal con su firma.",
    documentos:
      "Sube cada documento guiada paso a paso. El sistema sabe exactamente qué pedir.",
    formularios:
      "Sus formularios legales ya están completos al 100%, listos para revisar.",
    review:
      "Cada respuesta del I-589 generada y organizada por el sistema. Solo revisar y enviar.",
  },
};
