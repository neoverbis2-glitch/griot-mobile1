import { useState } from "react";
import { useT } from "@/lib/i18n";
import {
  Sparkles,
  ExternalLink,
  X,
  Loader2,
  Check,
} from "lucide-react";
import {
  saveGriotCredential,
  verifyGriotCredential,
} from "@/lib/griot-api";
import {
  saveUserApi,
  type UserSavedApi,
} from "@/lib/user-apis";
import { toast } from "sonner";

export const PROVIDER_INFO: Record<
  string,
  { label: string; short: string; vendor: string; hint: string; docUrl: string; placeholder: string }
> = {
  gemini: {
    label: "Google Gemini",
    short: "GE",
    vendor: "Google AI Studio",
    hint: "Multimodal & 2.5 Flash",
    docUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIzaSy...",
  },
  openai: {
    label: "OpenAI",
    short: "OA",
    vendor: "OpenAI",
    hint: "GPT-4o & Raciocínio",
    docUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-proj-...",
  },
  anthropic: {
    label: "Anthropic Claude",
    short: "CL",
    vendor: "Anthropic",
    hint: "Claude 3.5 Sonnet",
    docUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
  },
  deepseek: {
    label: "DeepSeek",
    short: "DS",
    vendor: "DeepSeek",
    hint: "DeepSeek V3 / R1",
    docUrl: "https://platform.deepseek.com/api_keys",
    placeholder: "sk-...",
  },
  groq: {
    label: "Groq",
    short: "GQ",
    vendor: "Groq Cloud",
    hint: "Llama 3.3 Ultra-rápido",
    docUrl: "https://console.groq.com/keys",
    placeholder: "gsk_...",
  },
  openrouter: {
    label: "OpenRouter",
    short: "OR",
    vendor: "OpenRouter",
    hint: "Roteador Universal",
    docUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-...",
  },
};

export interface AddApiModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (newApi: UserSavedApi) => void;
}

export function AddApiModal({ open, onClose, onSuccess }: AddApiModalProps) {
  const t = useT();
  const [selectedProvider, setSelectedProvider] = useState<string>("gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiLabelInput, setApiLabelInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSaveApi() {
    const secret = apiKeyInput.trim();
    if (!secret) {
      toast.error(t("Insere uma chave de API válida."));
      return;
    }

    setSubmitting(true);
    try {
      const pInfo = PROVIDER_INFO[selectedProvider];
      const customLabel = apiLabelInput.trim() || undefined;

      // 1. Guarda na camada estruturada do utilizador (suporta ilimitadas chaves do mesmo provedor)
      const savedUserApi = await saveUserApi({
        providerId: selectedProvider,
        apiKey: secret,
        label: customLabel,
      });

      // 2. Guarda também nas credenciais da conta do workspace
      try {
        const saved = await saveGriotCredential({
          providerId: selectedProvider,
          secret,
          label: customLabel || pInfo?.label || selectedProvider,
        });

        if (saved.data?.credential?.id) {
          void verifyGriotCredential(saved.data.credential.id).catch(() => {});
        }
      } catch {
        // Modo offline / sem workspace
      }

      toast.success(
        t("{provider} ligada com sucesso!", {
          provider: savedUserApi.label,
        }),
      );

      setApiKeyInput("");
      setApiLabelInput("");
      onClose();
      onSuccess?.(savedUserApi);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Não foi possível ligar a API."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-hairline bg-surface p-5 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-secondary text-primary">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h3 className="text-[16px] font-semibold leading-tight">{t("Ligar API de IA")}</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {t("Chave direta de orquestração")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Seletor de Provedor em Pills */}
        <div className="mt-4">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Provedor")}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {Object.entries(PROVIDER_INFO).map(([pid, p]) => (
              <button
                key={pid}
                type="button"
                onClick={() => {
                  setSelectedProvider(pid);
                  setApiKeyInput("");
                }}
                className={`flex flex-col items-start rounded-2xl border p-2.5 text-left transition-all ${
                  selectedProvider === pid
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40"
                    : "border-hairline bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {p.short}
                </span>
                <span className="mt-1 text-[12.5px] font-medium text-foreground truncate w-full">
                  {p.label.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Rótulo / Nome da API (Opcional) */}
        <div className="mt-3.5">
          <label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Nome / Rótulo da API")}
            <span className="text-muted-foreground/60 ml-1">({t("opcional")})</span>
          </label>
          <input
            type="text"
            value={apiLabelInput}
            onChange={(e) => setApiLabelInput(e.target.value)}
            placeholder={`Ex: ${PROVIDER_INFO[selectedProvider]?.label || selectedProvider} #1`}
            className="mt-1.5 w-full rounded-2xl border border-hairline bg-background px-4 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground/50 focus:border-primary transition-colors"
          />
        </div>

        {/* Input da Chave */}
        <div className="mt-3.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("Chave de API")}
            </label>
            {PROVIDER_INFO[selectedProvider]?.docUrl && (
              <a
                href={PROVIDER_INFO[selectedProvider].docUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                {t("Obter chave")}
                <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={PROVIDER_INFO[selectedProvider]?.placeholder || "Colar chave de API..."}
            className="mt-1.5 w-full rounded-2xl border border-hairline bg-background px-4 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground/60 focus:border-primary transition-colors"
            autoFocus
          />
        </div>

        {/* Ações */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-hairline bg-secondary/50 py-2.5 text-[13.5px] font-medium text-foreground hover:bg-secondary transition-colors"
          >
            {t("Cancelar")}
          </button>
          <button
            type="button"
            onClick={() => void handleSaveApi()}
            disabled={submitting || !apiKeyInput.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-primary py-2.5 text-[13.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all active:scale-[0.98]"
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{t("A ligar...")}</span>
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                <span>{t("Ligar API")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
