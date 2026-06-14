/**
 * F4-wizard i18n injection — adds cliente.formWizard / cliente.formularios and
 * extends cliente.historia in BOTH es.json + en.json in one pass, preserving key
 * parity (check:i18n). Microcopy ES is textual from the normative prompts
 * (cliente/20 + cliente/21); EN is the prototype tt() parity.
 *
 * Run once: node docs/_evidence/f4-wizard/inject-i18n.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MSG_DIR = resolve(__dirname, "../../../src/frontend/i18n/messages");

// Each leaf is [es, en].
const additions = {
  cliente: {
    formWizard: {
      stepCounter: ["Paso {n} de {total}", "Step {n} of {total}"],
      back: ["Atrás", "Back"],
      saving: ["Guardando…", "Saving…"],
      saved: ["Guardado", "Saved"],
      queued: ["Se guardará al reconectar", "Will save when you're back online"],
      saveError: ["Reintentando…", "Retrying…"],
      prefillChip: ["Ya lo tenemos", "We already have it"],
      prefillFromDocument: [
        "lo tomamos de tu documento",
        "we took it from your document",
      ],
      prefillFromProfile: ["lo tomamos de tu perfil", "we took it from your profile"],
      prefillFromGeneration: [
        "lo tomamos de tu solicitud",
        "we took it from your application",
      ],
      prefillEdited: ["Lo cambiaste tú", "You changed it"],
      selectPlaceholder: ["Elige una opción", "Choose an option"],
      textareaPlaceholder: [
        "Escribe aquí, o toca el micrófono para hablar…",
        "Type here, or tap the mic to speak…",
      ],
      checkboxYes: ["Sí", "Yes"],
      errRequired: ["Esto nos hace falta para continuar.", "We need this to continue."],
      errRegex: ["Revisa el formato, por favor.", "Please check the format."],
      errMin: ["Es un poco corto. ¿Puedes ampliar?", "That's a bit short. Can you add more?"],
      errMax: ["Es demasiado largo. Acórtalo un poco.", "That's too long. Shorten it a bit."],
      next: ["Siguiente", "Next"],
      finish: ["Terminar", "Finish"],
      submitting: ["Enviando…", "Sending…"],
      submitErrorTitle: ["No pudimos enviarlo", "We couldn't send it"],
      submitErrorBody: ["Vuelve a intentarlo en un momento.", "Please try again in a moment."],
      privacyNote: [
        "Tu información está protegida y es confidencial",
        "Your information is protected and confidential",
      ],
      dictateIdle: ["Tocar para hablar", "Tap to speak"],
      dictateActive: ["Escuchando… toca para parar", "Listening… tap to stop"],
      dictateUnsupported: [
        "El dictado no está disponible aquí. Puedes escribir.",
        "Dictation isn't available here. You can type instead.",
      ],
      submittedPill: ["Enviado", "Submitted"],
      submittedTitle: ["¡Listo! Lo recibimos", "Done! We got it"],
      submittedBody: ["Tu equipo lo está revisando.", "Your team is reviewing it."],
    },
    formularios: {
      eyebrow: ["Tu caso", "Your case"],
      title: ["Formularios", "Forms"],
      subtitle: [
        "Completa lo que tu equipo necesita. Todo se guarda solo.",
        "Fill in what your team needs. Everything saves on its own.",
      ],
      draft: ["Borrador", "Draft"],
      submitted: ["Enviado", "Submitted"],
      pending: ["Por empezar", "To start"],
      emptyTitle: ["No hay formularios por ahora", "No forms right now"],
      emptyBody: [
        "Cuando tu equipo necesite algún dato, aparecerá aquí.",
        "When your team needs any details, they'll appear here.",
      ],
      notFoundTitle: ["No encontramos ese formulario", "We couldn't find that form"],
      notFoundBody: [
        "Puede que ya no esté disponible. Escríbele a tu equipo si tienes dudas.",
        "It may no longer be available. Message your team if you have questions.",
      ],
      noVersionTitle: ["Este formulario aún no está listo", "This form isn't ready yet"],
      noVersionBody: [
        "Tu equipo lo está preparando. Te avisaremos en cuanto puedas completarlo.",
        "Your team is preparing it. We'll let you know as soon as you can fill it in.",
      ],
    },
    historia: {
      listeningChip: ["Te escucho con atención", "I'm listening carefully"],
    },
  },
};

function deepMergePick(target, src, idx) {
  for (const [key, value] of Object.entries(src)) {
    if (Array.isArray(value)) {
      target[key] = value[idx];
    } else if (value && typeof value === "object") {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepMergePick(target[key], value, idx);
    }
  }
}

for (const [file, idx] of [["es.json", 0], ["en.json", 1]]) {
  const path = resolve(MSG_DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  deepMergePick(json, additions, idx);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`updated ${file}`);
}
console.log("done");
