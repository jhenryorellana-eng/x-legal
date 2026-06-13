"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * SignaturePad — captura de firma (DOC-01 §5.2, DOC-51 §12 disclaimer + firma pública).
 * Ported from the prototype `V2/UI Cliente/app/screens8.jsx → SignaturePad`.
 *
 * Tabs: "Dibujar" (canvas, `touch-action:none`, signature line + "✕ Firma del
 * titular" legend) and "Subir imagen" (`accept="image/*"`, preview). The dashed
 * border turns from accent → green once signed. Below: ready/clear status.
 *
 * Extensions over the prototype required by the spec:
 * - `clear()` AND `undo()` (last stroke) — strokes are recorded as point lists
 *   and re-rendered so undo is exact.
 * - `getDataUrl()` (PNG) exposed imperatively via ref and via `onChange`'s
 *   second arg, so the disclaimer / public-signing flows can persist the image.
 */

export interface SignaturePadLabels {
  draw: string;
  upload: string;
  placeholder: string;
  legend: string;
  uploadPrompt: string;
  required: string;
  ready: string;
  clear: string;
  undo: string;
}

export interface SignaturePadHandle {
  /** Returns the current signature as a PNG data URL, or null when empty. */
  getDataUrl: () => string | null;
  clear: () => void;
}

export interface SignaturePadProps {
  labels: SignaturePadLabels;
  /** Notified when the signed state changes; `dataUrl` is the PNG (or null). */
  onChange?: (signed: boolean, dataUrl: string | null) => void;
}

type Pt = { x: number; y: number };

export const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  SignaturePadProps
>(function SignaturePad({ labels, onChange }, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const strokes = React.useRef<Pt[][]>([]);
  const [mode, setMode] = React.useState<"draw" | "upload">("draw");
  const [has, setHas] = React.useState(false);
  const [img, setImg] = React.useState<string | null>(null);

  const signed = has || img !== null;

  // (Re)size the canvas and configure the drawing context whenever the draw
  // tab becomes visible.
  React.useLayoutEffect(() => {
    if (mode !== "draw") return;
    const c = canvasRef.current;
    if (!c) return;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const ctxOf = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--navy")
          .trim() || "#002855";
    }
    return ctx ?? null;
  };

  const redraw = React.useCallback(() => {
    const c = canvasRef.current;
    const ctx = ctxOf();
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  }, []);

  const emit = React.useCallback(
    (isSigned: boolean) => {
      if (!onChange) return;
      onChange(isSigned, isSigned ? getDataUrl() : null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange],
  );

  const getDataUrl = React.useCallback((): string | null => {
    if (img) return img;
    if (!has) return null;
    return canvasRef.current?.toDataURL("image/png") ?? null;
  }, [img, has]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    drawing.current = true;
    strokes.current.push([
      { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY },
    ]);
    const ctx = ctxOf();
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    }
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const pt = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    strokes.current[strokes.current.length - 1]?.push(pt);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    if (!has) {
      setHas(true);
      emit(true);
    }
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = React.useCallback(() => {
    strokes.current = [];
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHas(false);
    setImg(null);
    emit(false);
  }, [emit]);

  const undo = () => {
    if (img) {
      clear();
      return;
    }
    strokes.current.pop();
    redraw();
    const stillHas = strokes.current.length > 0;
    setHas(stillHas);
    emit(stillHas);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setImg(url);
    emit(true);
  };

  React.useImperativeHandle(ref, () => ({ getDataUrl, clear }), [
    getDataUrl,
    clear,
  ]);

  const borderColor = signed ? "var(--green)" : "var(--accent)";

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {(
          [
            { id: "draw", label: labels.draw, icon: "edit" },
            { id: "upload", label: labels.upload, icon: "upload" },
          ] as const
        ).map((tab) => {
          const on = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              aria-pressed={on}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 12,
                cursor: "pointer",
                border: on
                  ? "2px solid var(--accent)"
                  : "2px solid var(--line)",
                background: on ? "var(--blue-soft)" : "var(--card)",
                color: on ? "var(--accent)" : "var(--ink-2)",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
              }}
            >
              <Icon
                name={tab.icon}
                size={17}
                color={on ? "var(--accent)" : "var(--ink-2)"}
              />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Pad */}
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          border: `2px dashed color-mix(in srgb, ${borderColor} 40%, transparent)`,
          background: "var(--card)",
          overflow: "hidden",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {mode === "draw" ? (
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            style={{
              display: "block",
              width: "100%",
              height: 168,
              touchAction: "none",
              cursor: "crosshair",
            }}
          />
        ) : (
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 168,
              cursor: "pointer",
              gap: 8,
            }}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img
                src={img}
                alt=""
                style={{ maxWidth: "85%", maxHeight: 140, objectFit: "contain" }}
              />
            ) : (
              <>
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 999,
                    background: "var(--blue-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="upload" size={26} color="var(--accent)" />
                </div>
                <span
                  style={{
                    fontSize: 14.5,
                    color: "var(--ink-2)",
                    fontWeight: 700,
                  }}
                >
                  {labels.uploadPrompt}
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={onFile}
              style={{ display: "none" }}
            />
          </label>
        )}

        {mode === "draw" && !has && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <span
              style={{ color: "var(--ink-3)", fontSize: 15, fontWeight: 600 }}
            >
              {labels.placeholder}
            </span>
          </div>
        )}

        {/* Signature line + legend */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 34,
            borderBottom: "1.5px solid var(--line)",
            pointerEvents: "none",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 24,
            bottom: 16,
            fontSize: 12,
            color: "var(--ink-3)",
            fontWeight: 700,
            pointerEvents: "none",
          }}
        >
          ✕ {labels.legend}
        </span>
      </div>

      {/* Status row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 9,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            color: signed ? "var(--green)" : "var(--ink-3)",
          }}
        >
          {signed ? (
            <>
              <Icon name="check" size={15} color="var(--green)" stroke={3} />
              {labels.ready}
            </>
          ) : (
            labels.required
          )}
        </span>
        {signed && (
          <div style={{ display: "flex", gap: 14 }}>
            {!img && strokes.current.length > 0 && (
              <button
                type="button"
                onClick={undo}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ink-2)",
                  fontSize: 13.5,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "var(--font-title)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Icon name="arrowL" size={15} color="var(--ink-2)" />
                {labels.undo}
              </button>
            )}
            <button
              type="button"
              onClick={clear}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontSize: 13.5,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "var(--font-title)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon name="x" size={15} color="var(--accent)" />
              {labels.clear}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
