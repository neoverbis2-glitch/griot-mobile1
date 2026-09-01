import { useState } from "react";
import {
  Copy,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  RefreshCw,
  Square,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

function Action({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`grid size-8 place-items-center rounded-full transition-all duration-200 active:scale-90 ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground active:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

export function UserActions({ content, onEdit }: { content: string; onEdit: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-1.5 flex items-center justify-end gap-0.5 pr-0.5 opacity-70">
      <Action
        label={t("Copiar")}
        onClick={async () => {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-[15px]" /> : <Copy className="size-[15px]" />}
      </Action>
      <Action label={t("Editar")} onClick={onEdit}>
        <Pencil className="size-[15px]" />
      </Action>
    </div>
  );
}

export function AssistantActions({
  content,
  feedback,
  onFeedback,
  onRegenerate,
}: {
  content: string;
  feedback: string | null;
  onFeedback: (value: "like" | "dislike" | null) => void;
  onRegenerate: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  function speak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error(t("Este dispositivo não permite leitura em voz alta."));
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = "pt-PT";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <div className="mt-2 flex items-center gap-0.5">
      <Action
        label={t("Gosto")}
        active={feedback === "like"}
        onClick={() => onFeedback(feedback === "like" ? null : "like")}
      >
        <ThumbsUp className="size-[15px]" />
      </Action>
      <Action
        label={t("Não gosto")}
        active={feedback === "dislike"}
        onClick={() => onFeedback(feedback === "dislike" ? null : "dislike")}
      >
        <ThumbsDown className="size-[15px]" />
      </Action>
      <Action label={t("Ler em voz alta")} active={speaking} onClick={speak}>
        {speaking ? <Square className="size-[13px]" /> : <Volume2 className="size-[15px]" />}
      </Action>
      <Action label={t("Regenerar")} onClick={onRegenerate}>
        <RefreshCw className="size-[15px]" />
      </Action>
      <Action
        label={t("Copiar")}
        onClick={async () => {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-[15px]" /> : <Copy className="size-[15px]" />}
      </Action>
    </div>
  );
}
