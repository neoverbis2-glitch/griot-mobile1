import { useState } from "react";
import { Brain, ChevronDown, BookOpen, Search, Code, PenLine } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { ExecutionPhase } from "@/lib/chat-execution-manager";

type Props = {
  text: string;
  active: boolean;
  steps: number;
  phase?: ExecutionPhase;
  actionDetail?: string;
  onStop?: () => void;
};

/**
 * Painel de atividade e raciocínio real:
 * Mostra com ícones e status verdadeiros o que a IA está a fazer:
 * - Livro (BookOpen): quando está a ler ficheiros anexados ou projeto
 * - Lupa (Search): quando está a pesquisar no código ou base de conhecimento
 * - Código (Code): quando está a inspecionar/editar ficheiros ou patches
 * - Caneta (PenLine): quando está a compor a resposta
 * - Cérebro (Brain): quando está a deliberar e a raciocinar
 */
export function Thinking({ text, active, steps, phase = "thinking", actionDetail }: Props) {
  const t = useT();
  const [open, setOpen] = useState(true);

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Mapeia o ícone e a descrição em tempo real com base no estado verídico da execução
  const getPhaseInfo = () => {
    switch (phase) {
      case "reading":
        return {
          icon: <BookOpen className="size-[15px] text-amber-400" />,
          title: actionDetail ? t(actionDetail) : t("A ler ficheiros..."),
          badge: t("Leitura de ficheiros"),
        };
      case "searching":
        return {
          icon: <Search className="size-[15px] text-sky-400" />,
          title: actionDetail ? t(actionDetail) : t("A pesquisar..."),
          badge: t("Pesquisa"),
        };
      case "editing":
        return {
          icon: <Code className="size-[15px] text-emerald-400" />,
          title: actionDetail ? t(actionDetail) : t("A editar código..."),
          badge: t("Edição"),
        };
      case "writing":
        return {
          icon: <PenLine className="size-[15px] text-indigo-400" />,
          title: actionDetail ? t(actionDetail) : t("A escrever resposta..."),
          badge: t("Geração"),
        };
      case "thinking":
      default:
        return {
          icon: <Brain className="size-[15px] text-purple-400" />,
          title: actionDetail ? t(actionDetail) : t("A raciocinar..."),
          badge: steps > 0 ? `${steps} ${t("decisões")}` : t("Cadeia de decisão"),
        };
    }
  };

  const phaseInfo = getPhaseInfo();

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
            {phaseInfo.icon}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className={`block text-[13.5px] font-medium truncate ${active ? "shimmer-text" : ""}`}>
              {active ? phaseInfo.title : t("Processamento")}
            </span>
            <span className="block text-[11.5px] text-muted-foreground truncate">
              {phaseInfo.badge}
            </span>
          </span>
        </button>

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
            <div className="flex items-center gap-2.5 py-1 text-[13px] text-muted-foreground">
              <span className="size-2 rounded-full bg-primary/70 animate-pulse" />
              <span className="truncate">
                {active
                  ? (actionDetail || phaseInfo.title)
                  : t("Pronto a responder")}
              </span>
            </div>
          ) : (
            <ol className="space-y-2.5 max-h-48 overflow-y-auto no-scrollbar">
              {lines.map((line, index) => (
                <li key={index} className="rise flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground/35" />
                  <span className="text-[13px] leading-relaxed text-muted-foreground break-words">{line}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
