import { useEffect, useState } from "react";
import { Brain, ChevronDown, Square } from "lucide-react";
import { useT } from "@/lib/i18n";

type Props = { text: string; active: boolean; steps: number; onStop?: () => void };

const PHASES = [
  "A ler o pedido",
  "A recolher contexto",
  "A pesar alternativas",
  "A decidir o caminho",
  "A compor a resposta",
];

/**
 * Painel de raciocínio: mostra em tempo real o que o GRIOT está a pensar
 * e as decisões que vai tomando. Fecha-se sozinho quando a resposta começa.
 */
export function Thinking({ text, active, steps, onStop }: Props) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setPhase((value) => (value + 1) % PHASES.length), 2200);
    return () => window.clearInterval(timer);
  }, [active]);

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="rise overflow-hidden rounded-[22px] border border-hairline bg-surface/60 backdrop-blur-xl">
      <div className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex flex-1 items-center gap-3 min-w-0"
        >
          <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-secondary">
            {active ? (
              <span className="pulse-ring absolute inset-0 rounded-full bg-foreground/15" />
            ) : null}
            <Brain className="size-[15px]" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className={`block text-[13.5px] font-medium ${active ? "shimmer-text" : ""}`}>
              {active ? t(PHASES[phase] ?? PHASES[0] ?? "A pensar") : t("Raciocínio")}
            </span>
            <span className="block text-[11.5px] text-muted-foreground">
              {steps > 0 ? `${steps} ${t("decisões")}` : t("cadeia de decisão")}
            </span>
          </span>
        </button>

        {active && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-full bg-secondary/90 px-3 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-secondary active:scale-95 transition-all shadow-xs"
          >
            <Square className="size-2.5 fill-current" />
            <span>{t("Parar")}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="grid size-7 place-items-center rounded-full active:scale-90"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {open ? (
        <div className="border-t border-hairline px-4 py-3">
          {lines.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="ghost-line block h-[9px] rounded-full bg-foreground/10"
                  style={{ animationDelay: `${index * 180}ms`, width: `${92 - index * 22}%` }}
                />
              ))}
            </div>
          ) : (
            <ol className="space-y-2.5">
              {lines.map((line, index) => (
                <li key={index} className="rise flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground/35" />
                  <span className="text-[13px] leading-relaxed text-muted-foreground">{line}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
