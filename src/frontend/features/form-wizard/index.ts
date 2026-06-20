/**
 * FormWizard — shared data-driven form motor (DOC-50 §6, Propuesta SOT-3).
 * Public surface consumed by the cliente page and the staff form-editor preview.
 */

export { FormWizard } from "./form-wizard";
export type { FormWizardProps } from "./form-wizard";
export { WizardField } from "./fields";
export { useAutosave } from "./use-autosave";
export { useDictation } from "./use-dictation";
export {
  buildQuestionSchema,
  buildGroupSchema,
  validateQuestion,
  validateGroup,
  firstInvalidGroupIndex,
} from "./build-question-schema";
export { pickI18n, buildInitialAnswers, isReadOnly, coerceInitialValue } from "./resolve";
export { resolveWizardLabels } from "./labels";
export type {
  WizardForm,
  WizardGroup,
  WizardQuestion,
  WizardLabels,
  Locale,
  I18nValue,
  FieldType,
  QuestionValidation,
  SaveState,
  SaveDraftFn,
  SubmitFormFn,
  TranslateAnswersFn,
  SaveDraftResult,
  SubmitFormResult,
  AnswersMap,
  FieldErrorCode,
} from "./types";
export { translateClientAnswers } from "./answer-translation";
