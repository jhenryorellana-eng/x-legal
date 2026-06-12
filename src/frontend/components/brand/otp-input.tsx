"use client";

/**
 * OtpInput — 6-casilla OTP component (DOC-51-UI-CLIENTE §4, PROMPT-CLI-04).
 *
 * Behavior:
 * - Auto-focus on first box ~350ms after mount.
 * - Auto-advance on digit entry.
 * - Backspace on empty box moves focus to previous.
 * - Paste fills all 6 boxes (ignores non-digits).
 * - Auto-submits when the 6th digit is entered (calls onComplete).
 *
 * Visual states (border-color per box):
 * - empty      : --line (gris)
 * - has digit  : --accent (azul)
 * - error      : --gold-deep (dorado — NEVER red; DOC-01, prompt-04)
 */

import * as React from "react";

export interface OtpInputProps {
  /** Called with the 6-digit string whenever any digit changes */
  onChange?: (value: string) => void;
  /** Called when all 6 digits are filled — triggers auto-submit */
  onComplete?: (value: string) => void;
  /** Show error state (golden borders) */
  error?: boolean;
  /** Disable all inputs (e.g. during loading) */
  disabled?: boolean;
  /** Controlled value — if provided, the component is controlled */
  value?: string;
}

const BOX_COUNT = 6;
const BOX_SIZE = 48;
const BOX_HEIGHT = 60;

export function OtpInput({
  onChange,
  onComplete,
  error = false,
  disabled = false,
  value: controlledValue,
}: OtpInputProps) {
  const [internalDigits, setInternalDigits] = React.useState<string[]>(
    Array(BOX_COUNT).fill(""),
  );
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  // Controlled vs uncontrolled
  const isControlled = controlledValue !== undefined;
  const digits = isControlled
    ? Array.from({ length: BOX_COUNT }, (_, i) => controlledValue[i] ?? "")
    : internalDigits;

  // Auto-focus first input after mount
  React.useEffect(() => {
    const timer = setTimeout(() => {
      refs.current[0]?.focus();
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  function updateDigits(next: string[]) {
    if (!isControlled) setInternalDigits(next);
    const joined = next.join("");
    onChange?.(joined);
    if (next.every((d) => d !== "") && next.length === BOX_COUNT) {
      onComplete?.(joined);
    }
  }

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) return;

    // Handle paste into a single box: distribute across remaining boxes
    if (raw.length > 1) {
      const next = [...digits];
      let pos = index;
      for (let i = 0; i < raw.length && pos < BOX_COUNT; i++, pos++) {
        next[pos] = raw[i];
      }
      updateDigits(next);
      const nextFocus = Math.min(index + raw.length, BOX_COUNT - 1);
      refs.current[nextFocus]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = raw[0];
    updateDigits(next);

    // Auto-advance
    if (index < BOX_COUNT - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index]) {
        // Clear current box
        const next = [...digits];
        next[index] = "";
        updateDigits(next);
      } else if (index > 0) {
        // Move to previous
        const next = [...digits];
        next[index - 1] = "";
        updateDigits(next);
        refs.current[index - 1]?.focus();
      }
      e.preventDefault();
    }

    if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < BOX_COUNT - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, BOX_COUNT);
    const next = Array(BOX_COUNT).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    updateDigits(next);
    const nextFocus = Math.min(pasted.length, BOX_COUNT - 1);
    refs.current[nextFocus]?.focus();
  }

  function borderColor(digit: string): string {
    if (error) return "var(--gold-deep)";
    if (digit) return "var(--accent)";
    return "var(--line)";
  }

  return (
    <div
      style={{ display: "flex", gap: 10, justifyContent: "center" }}
      role="group"
      aria-label="Código de verificación de 6 dígitos"
    >
      {Array.from({ length: BOX_COUNT }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digits[i]}
          disabled={disabled}
          aria-label={`Dígito ${i + 1} de ${BOX_COUNT}`}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          style={{
            width: BOX_SIZE,
            height: BOX_HEIGHT,
            borderRadius: 15,
            border: `2.5px solid ${borderColor(digits[i])}`,
            background: "var(--card)",
            color: "var(--ink)",
            fontFamily: "var(--font-title)",
            fontWeight: 700,
            fontSize: 24,
            textAlign: "center",
            outline: "none",
            caretColor: "var(--accent)",
            transition: "border-color 0.2s ease",
            cursor: disabled ? "default" : "text",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      ))}
    </div>
  );
}
