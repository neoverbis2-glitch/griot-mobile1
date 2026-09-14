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
  Heart,
  SmilePlus,
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

const QUICK_EMOJIS = ["👍", "❤️", "🔥", "💡", "🚀"];

export function UserActions({
  content,
  onEdit,
  onReact,
  hasUserLiked,
}: {
  content: string;
  onEdit: () => void;
  onReact?: (emoji: string) => void;
  hasUserLiked?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="relative mt-1.5 flex items-center justify-end gap-0.5 pr-0.5 opacity-80">
      {showPicker && (
        <div className="absolute right-0 -top-9 z-20 flex items-center gap-1 rounded-full border border-hairline/80 bg-card/95 px-2 py-1 shadow-lg backdrop-blur-md animate-fade-in">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact?.(emoji);
                setShowPicker(false);
              }}
              className="grid size-6 place-items-center rounded-full text-xs hover:scale-125 transition-transform"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {onReact && (
        <Action
          label={t("Reagir")}
          active={hasUserLiked}
          onClick={() => {
            if (showPicker) {
              setShowPicker(false);
            } else {
              setShowPicker(true);
            }
          }}
        >
          <SmilePlus className="size-[14px]" />
        </Action>
      )}

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
  onReact,
  hasUserLiked,
}: {
  content: string;
  feedback: string | null;
  onFeedback: (value: "like" | "dislike" | null) => void;
  onRegenerate: () => void;
  onReact?: (emoji: string) => void;
  hasUserLiked?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

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
    <div className="relative mt-2 flex items-center gap-0.5">
      {showPicker && (
        <div className="absolute left-0 -top-9 z-20 flex items-center gap-1 rounded-full border border-hairline/80 bg-card/95 px-2 py-1 shadow-lg backdrop-blur-md animate-fade-in">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact?.(emoji);
                setShowPicker(false);
              }}
              className="grid size-6 place-items-center rounded-full text-xs hover:scale-125 transition-transform"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {onReact && (
        <Action
          label={t("Reagir")}
          active={hasUserLiked}
          onClick={() => {
            if (showPicker) {
              setShowPicker(false);
            } else {
              setShowPicker(true);
            }
          }}
        >
          <SmilePlus className="size-[14px]" />
        </Action>
      )}

      <Action
        label={t("Gosto")}
        active={feedback === "like"}
        onClick={() => {
          onFeedback(feedback === "like" ? null : "like");
          if (onReact && feedback !== "like") {
            onReact("👍");
          }
        }}
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
