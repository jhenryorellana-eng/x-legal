"use client";

import * as React from "react";
import {
  Avatar,
  Card,
  Chip,
  GhostBtn,
  GradientBtn,
  Icon,
  ICON_NAMES,
  Lex,
  ProgressBar,
  ProgressRing,
  StatusPill,
  Stepper,
  ThemeToggle,
  Timeline,
  type LexMood,
} from "@/frontend/components/brand";
import { Button } from "@/frontend/components/ui/button";
import {
  Card as ShadCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/frontend/components/ui/card";
import { Input } from "@/frontend/components/ui/input";
import { Label } from "@/frontend/components/ui/label";
import { Switch } from "@/frontend/components/ui/switch";
import { Skeleton } from "@/frontend/components/ui/skeleton";

/* ── Layout helpers ─────────────────────────────────────────────────────── */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 40 }}>
      <h2
        className="t-black"
        style={{ fontSize: 22, color: "var(--navy)", margin: "0 0 4px" }}
      >
        {title}
      </h2>
      {hint && (
        <p
          style={{
            margin: "0 0 18px",
            color: "var(--ink-2)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {hint}
        </p>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Tile({
  label,
  children,
  width = 260,
}: {
  label: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: "var(--ink-2)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const LEX_MOODS: LexMood[] = ["calma", "feliz", "atento", "señala", "celebra"];

export default function DesignShowcasePage() {
  const [staff, setStaff] = React.useState(false);

  return (
    <div className={staff ? "surface-staff" : undefined}>
      <main
        style={{
          minHeight: "100vh",
          padding: "28px clamp(16px, 5vw, 56px) 80px",
          maxWidth: 1240,
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            zIndex: 10,
            background:
              "color-mix(in srgb, var(--bg) 86%, transparent)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            padding: "12px 0",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <BrandMark />
            <div>
              <h1
                className="t-black"
                style={{ fontSize: 24, margin: 0, color: "var(--navy)" }}
              >
                Design System
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--ink-2)",
                }}
              >
                UsaLatinoPrime V2 · Fase F0 · DOC-01
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStaff((s) => !s)}
              aria-pressed={staff}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: staff ? "var(--accent)" : "var(--card)",
                color: staff ? "var(--on-accent)" : "var(--ink)",
                cursor: "pointer",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              {staff ? "Superficie: Staff" : "Superficie: Cliente"}
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* Brand color primitives */}
        <Section title="Primitivas de marca" hint="No cambian con el tema (DOC-01 §3.1)">
          {[
            ["navy", "var(--brand-navy)"],
            ["blue", "var(--brand-blue)"],
            ["blue-2", "var(--brand-blue-2)"],
            ["blue-deep", "var(--brand-blue-deep)"],
            ["gold", "var(--brand-gold)"],
            ["gold-2", "var(--brand-gold-2)"],
            ["gold-deep", "var(--brand-gold-deep)"],
            ["green", "var(--brand-green)"],
            ["green-2", "var(--brand-green-2)"],
            ["red", "var(--brand-red)"],
            ["red-2", "var(--brand-red-2)"],
          ].map(([name, value]) => (
            <Swatch key={name} name={name} value={value} />
          ))}
        </Section>

        {/* Semantic tokens (reactive to theme + surface) */}
        <Section
          title="Tokens semánticos"
          hint="Reaccionan al tema y a la superficie activa (DOC-01 §3.2 / §3.3)"
        >
          {[
            ["bg", "var(--bg)"],
            ["card", "var(--card)"],
            ["card-alt", "var(--card-alt)"],
            ["ink", "var(--ink)"],
            ["ink-2", "var(--ink-2)"],
            ["ink-3", "var(--ink-3)"],
            ["line", "var(--line)"],
            ["accent", "var(--accent)"],
            ["gold", "var(--gold)"],
            ["green", "var(--green)"],
            ["red", "var(--red)"],
            ["blue-soft", "var(--blue-soft)"],
            ["gold-soft", "var(--gold-soft)"],
            ["green-soft", "var(--green-soft)"],
            ["red-soft", "var(--red-soft)"],
          ].map(([name, value]) => (
            <Swatch key={name} name={name} value={value} bordered />
          ))}
        </Section>

        {/* GradientBtn */}
        <Section title="GradientBtn" hint="Botón primario — hover, press, disabled, tamaños (DOC-01 §5.1)">
          <Tile label="lg · default">
            <GradientBtn icon="bolt">Empezar ahora</GradientBtn>
          </Tile>
          <Tile label="md">
            <GradientBtn size="md" icon="check">
              Confirmar
            </GradientBtn>
          </Tile>
          <Tile label="sm">
            <GradientBtn size="sm">Enviar</GradientBtn>
          </Tile>
          <Tile label="animated (cicla a dorado)">
            <GradientBtn animated icon="trophy">
              ¡Felicitaciones!
            </GradientBtn>
          </Tile>
          <Tile label="disabled">
            <GradientBtn disabled icon="lock">
              No disponible
            </GradientBtn>
          </Tile>
          <Tile label="auto width">
            <GradientBtn full={false} icon="phone">
              Llamar
            </GradientBtn>
          </Tile>
        </Section>

        {/* GhostBtn */}
        <Section title="GhostBtn" hint="Botón secundario (DOC-01 §5.1)">
          <Tile label="lg">
            <GhostBtn icon="edit">Editar</GhostBtn>
          </Tile>
          <Tile label="md">
            <GhostBtn size="md" icon="copy">
              Copiar enlace
            </GhostBtn>
          </Tile>
          <Tile label="disabled">
            <GhostBtn disabled icon="x">
              Cancelar
            </GhostBtn>
          </Tile>
        </Section>

        {/* StatusPill + Chip */}
        <Section title="StatusPill" hint="Color + icono + texto (DOC-01 §5.1 / §8.4)">
          <Tile label="variantes" width={520}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <StatusPill kind="aprobado">Aprobado</StatusPill>
              <StatusPill kind="revision">En revisión</StatusPill>
              <StatusPill kind="pendiente">Pendiente</StatusPill>
              <StatusPill kind="corregir">Corregir</StatusPill>
              <StatusPill kind="hecho">Hecho</StatusPill>
            </div>
          </Tile>
        </Section>

        <Section title="Chip" hint="Tintes blue · gold · green · amber · red (DOC-01 §5.1)">
          <Tile label="tonos" width={520}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Chip tone="blue" dot>
                Información
              </Chip>
              <Chip tone="gold" dot>
                Atención
              </Chip>
              <Chip tone="green" dot>
                En línea
              </Chip>
              <Chip tone="amber">Ámbar</Chip>
              <Chip tone="red" dot>
                Urgente
              </Chip>
            </div>
          </Tile>
        </Section>

        {/* Progress */}
        <Section title="Progreso" hint="ProgressRing (donut) + ProgressBar (DOC-01 §5.1)">
          <Tile label="ring 0%" width={120}>
            <ProgressRing pct={0} />
          </Tile>
          <Tile label="ring 38%" width={120}>
            <ProgressRing pct={38} sub="3 / 8" />
          </Tile>
          <Tile label="ring 100%" width={140}>
            <ProgressRing pct={100} size={120} stroke={10} label="¡Listo!" />
          </Tile>
          <Tile label="bar" width={300}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ProgressBar pct={20} />
              <ProgressBar pct={62} height={12} />
              <ProgressBar pct={92} />
            </div>
          </Tile>
        </Section>

        {/* Lex */}
        <Section title="Lex — mascota" hint="Moods: calma · feliz · atento · señala · celebra (DOC-01 §5.1)">
          {LEX_MOODS.map((mood) => (
            <Tile key={mood} label={mood} width={150}>
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  minHeight: 150,
                  background: "var(--card)",
                  borderRadius: "var(--r-lg)",
                  boxShadow: "var(--shadow-soft)",
                }}
              >
                <Lex mood={mood} size={120} />
              </div>
            </Tile>
          ))}
        </Section>

        {/* Avatar */}
        <Section title="Avatar" hint="Gradiente staff (navy→accent) / usuario (gold→red) (DOC-01 §5.1)">
          <Tile label="staff" width={120}>
            <div style={{ display: "flex", gap: 10 }}>
              <Avatar name="Vanessa" variant="staff" />
              <Avatar name="Diana" variant="staff" size={56} />
            </div>
          </Tile>
          <Tile label="usuario" width={120}>
            <div style={{ display: "flex", gap: 10 }}>
              <Avatar name="María" variant="user" />
              <Avatar name="José" variant="user" size={56} />
            </div>
          </Tile>
        </Section>

        {/* Card */}
        <Section title="Card" hint="Estática vs interactiva (hover-lift) (DOC-01 §5.1)">
          <Tile label="estática" width={280}>
            <Card>
              <strong style={{ color: "var(--ink)" }}>Tu caso de asilo</strong>
              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--ink-2)",
                  fontSize: 14,
                }}
              >
                Avanza paso a paso con tu equipo.
              </p>
            </Card>
          </Tile>
          <Tile label="interactiva + glow" width={280}>
            <Card interactive glow="var(--accent)">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Icon name="briefcase" size={22} color="var(--accent)" />
                <strong style={{ color: "var(--ink)" }}>Abrir expediente</strong>
              </div>
            </Card>
          </Tile>
        </Section>

        {/* Timeline + Stepper */}
        <Section title="Timeline" hint="Agrupado por día con dot por tipo (DOC-01 §5.1)">
          <Tile label="eventos" width={420}>
            <Timeline
              groups={[
                {
                  label: "Hoy",
                  items: [
                    {
                      id: "1",
                      type: "success",
                      icon: "check",
                      title: "Documento aprobado",
                      meta: "10:24",
                      body: "Tu pasaporte fue verificado.",
                    },
                    {
                      id: "2",
                      type: "call",
                      icon: "phone",
                      title: "Llamada con tu abogado",
                      meta: "14:00",
                    },
                  ],
                },
                {
                  label: "Ayer",
                  items: [
                    {
                      id: "3",
                      type: "info",
                      icon: "upload",
                      title: "Formulario I-589 enviado",
                      meta: "18:42",
                    },
                  ],
                },
              ]}
            />
          </Tile>
        </Section>

        <Section title="Stepper" hint="done · current · upcoming (lock) (DOC-01 §5.1)">
          <Tile label="vertical" width={260}>
            <Stepper
              steps={[
                { id: "a", label: "Datos personales", state: "done" },
                { id: "b", label: "Documentos", state: "done" },
                { id: "c", label: "Revisión legal", state: "current" },
                { id: "d", label: "Firma", state: "upcoming" },
                { id: "e", label: "Envío", state: "upcoming", locked: true },
              ]}
            />
          </Tile>
          <Tile label="horizontal" width={420}>
            <Stepper
              orientation="horizontal"
              steps={[
                { id: "a", label: "Cuenta", state: "done" },
                { id: "b", label: "Caso", state: "current" },
                { id: "c", label: "Pago", state: "upcoming" },
              ]}
            />
          </Tile>
        </Section>

        {/* Icon set */}
        <Section
          title={`Set de iconos (${ICON_NAMES.length})`}
          hint="SVG inline, currentColor, siempre con etiqueta (DOC-01 §6)"
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 10,
              width: "100%",
            }}
          >
            {ICON_NAMES.map((name) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 6px",
                  background: "var(--card)",
                  borderRadius: "var(--r-md)",
                  boxShadow: "var(--shadow-soft)",
                }}
              >
                <Icon name={name} size={26} color="var(--accent)" />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink-2)",
                  }}
                >
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* shadcn components */}
        <Section title="shadcn/ui (staff)" hint="Tematizado con tokens de marca (DOC-01 §4)">
          <Tile label="buttons" width={520}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Eliminar</Button>
              <Button disabled>Disabled</Button>
            </div>
          </Tile>
          <Tile label="card" width={300}>
            <ShadCard>
              <CardHeader>
                <CardTitle>Cliente nuevo</CardTitle>
                <CardDescription>Crea un expediente en segundos.</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Label htmlFor="nombre">Nombre</Label>
                    <Input id="nombre" placeholder="Ej. María Pérez" />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <Switch id="notif" defaultChecked />
                    <Label htmlFor="notif">Enviar notificaciones</Label>
                  </div>
                </div>
              </CardContent>
            </ShadCard>
          </Tile>
        </Section>

        {/* States: loading / empty / error */}
        <Section title="Estados" hint="loading (skeleton) · empty (Lex) · error (DOC-01 §5.3)">
          <Tile label="loading" width={280}>
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </Card>
          </Tile>
          <Tile label="empty" width={280}>
            <Card>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 8,
                }}
              >
                <Lex size={92} mood="atento" />
                <strong style={{ color: "var(--ink)" }}>Sin documentos aún</strong>
                <span style={{ color: "var(--ink-2)", fontSize: 14 }}>
                  Sube tu primer archivo para empezar.
                </span>
                <GradientBtn size="sm" icon="upload" full={false}>
                  Subir documento
                </GradientBtn>
              </div>
            </Card>
          </Tile>
          <Tile label="error" width={280}>
            <Card glow="var(--red)">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Icon name="info" size={22} color="var(--red)" />
                <div>
                  <strong style={{ color: "var(--ink)" }}>
                    No se pudo enviar
                  </strong>
                  <p
                    style={{
                      margin: "4px 0 10px",
                      color: "var(--ink-2)",
                      fontSize: 14,
                    }}
                  >
                    Revisa tu conexión e inténtalo otra vez.
                  </p>
                  <GhostBtn
                    size="md"
                    full={false}
                    icon="route"
                    color="var(--red)"
                  >
                    Reintentar
                  </GhostBtn>
                </div>
              </div>
            </Card>
          </Tile>
        </Section>

        <footer
          style={{
            marginTop: 56,
            paddingTop: 20,
            borderTop: "1px solid var(--line)",
            color: "var(--ink-2)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Criterio de salida F0 · todos los componentes de DOC-01 §5.1 + tokens
          §3 + motion §7 en light/dark, cliente/staff.
        </footer>
      </main>
    </div>
  );
}

/* ── Small inline atoms used only by this showcase ──────────────────────── */

function BrandMark() {
  return (
    <span
      style={{
        position: "relative",
        width: 38,
        height: 38,
        borderRadius: 11,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, var(--brand-navy), var(--accent))",
        color: "#fff",
        fontFamily: "var(--font-title)",
        fontWeight: 900,
        fontSize: 18,
        boxShadow: "0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      U
      <span
        aria-hidden="true"
        className="anim-sheen"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%)",
        }}
      />
    </span>
  );
}

function Swatch({
  name,
  value,
  bordered = false,
}: {
  name: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div style={{ width: 120 }}>
      <div
        style={{
          height: 56,
          borderRadius: "var(--r-md)",
          background: value,
          border: bordered ? "1px solid var(--line)" : undefined,
          boxShadow: "inset 0 0 0 1px rgba(11,27,51,0.06)",
        }}
      />
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          fontWeight: 700,
          color: "var(--ink-2)",
        }}
      >
        {name}
      </div>
    </div>
  );
}
