import { useState, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/i18n";
import {
  ChevronRight,
  Cpu,
  Plus,
  Key,
  Check,
  Trash2,
  Sparkles,
  ExternalLink,
  X,
  Loader2,
} from "lucide-react";
import {
  listGriotCredentials,
  saveGriotCredential,
  verifyGriotCredential,
  deleteGriotCredential,
  type GriotCredential,
} from "@/lib/griot-api";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ConnectedApiItem {
  id: string;
  providerId: string;
  label: string;
  short: string;
  vendor: string;
  hint: string;
  secretHint?: string;
  status: "active" | "pending" | "revoked";
  isLocalOnly?: boolean;
}

const PROVIDER_INFO: Record<
  string,
  { label: string; short: string; vendor: string; hint: string; docUrl: string; placeholder: string }
> = {
  gemini: {
    label: "Google Gemini",
    short: "GE",
    vendor: "Google AI Studio",
    hint: "Multimodal & 2.0 Flash",
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

/**
 * Painel de APIs: mostra exclusivamente as APIs de IA que o utilizador adicionou
 * e configurou no GRIOT. Se não houver nenhuma, apresenta um estado limpo
 * com um botão elegante para ligar a primeira API.
 */
export function ApisPanel({
  connected: _connected,
  desktopOnline: _desktopOnline,
}: {
  connected?: Record<string, boolean>;
  desktopOnline?: boolean;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState<GriotCredential[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Carrega as credenciais ativas do backend e localStorage instantaneamente
  const refreshApis = async () => {
    try {
      // 1. Consulta rápida direta às tabelas PostgREST (50ms)
      const { data } = await (supabase as any)
        .from("griot_credentials")
        .select("id, provider_id, label, kind, status")
        .eq("status", "active");

      if (Array.isArray(data) && data.length > 0) {
        setCredentials(
          data.map((d: any) => ({
            id: d.id,
            kind: d.kind || "provider",
            providerId: d.provider_id,
            label: d.label || d.provider_id,
            settings: {},
            status: d.status || "active",
            secretHint: "••••••••",
          })),
        );
      }
    } catch {
      // continua para a função remota
    }

    try {
      const res = await listGriotCredentials("provider");
      if (res.data?.credentials && res.data.credentials.length > 0) {
        setCredentials(res.data.credentials);
      }
    } catch (err) {
      console.warn("Não foi possível listar credenciais remotas:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshApis();
    const handleUpdate = () => void refreshApis();
    window.addEventListener("griot-apis-updated", handleUpdate);
    return () => window.removeEventListener("griot-apis-updated", handleUpdate);
  }, []);

  // Mapeia as APIs adicionadas (combina remotas e locais se existirem)
  const connectedApis = useMemo(() => {
    const list: ConnectedApiItem[] = [];
    const seen = new Set<string>();

    // APIs do Supabase
    for (const cred of credentials) {
      const p = PROVIDER_INFO[cred.providerId] || {
        label: cred.label || cred.providerId,
        short: cred.providerId.slice(0, 2).toUpperCase(),
        vendor: cred.providerId,
        hint: "API Configurada",
        docUrl: "",
        placeholder: "",
      };
      seen.add(cred.providerId);
      list.push({
        id: cred.id,
        providerId: cred.providerId,
        label: p.label,
        short: p.short,
        vendor: p.vendor,
        hint: p.hint,
        secretHint: cred.secretHint,
        status: cred.status,
      });
    }

    // Verifica chaves salvas localmente
    if (typeof window !== "undefined") {
      for (const [key, p] of Object.entries(PROVIDER_INFO)) {
        if (!seen.has(key)) {
          const localVal =
            localStorage.getItem(`griot_api_key_${key}`) ||
            localStorage.getItem(`griot_${key}_api_key`);
          if (localVal && localVal.trim().length > 5) {
            seen.add(key);
            list.push({
              id: `local-${key}`,
              providerId: key,
              label: p.label,
              short: p.short,
              vendor: p.vendor,
              hint: p.hint,
              secretHint: `••••${localVal.slice(-4)}`,
              status: "active",
              isLocalOnly: true,
            });
          }
        }
      }
    }

    return list;
  }, [credentials]);

  const handleSaveApi = async () => {
    const secret = apiKeyInput.trim();
    if (!secret) return;
    setSubmitting(true);

    try {
      // 1. Guarda no localStorage para disponibilidade offline imediata
      if (typeof window !== "undefined") {
        localStorage.setItem(`griot_api_key_${selectedProvider}`, secret);
      }

      // 2. Guarda encriptado no Supabase (se autenticado)
      const res = await saveGriotCredential({
        providerId: selectedProvider as any,
        secret,
        label: PROVIDER_INFO[selectedProvider]?.label || selectedProvider,
      });

      if (res.data?.credential) {
        void verifyGriotCredential(res.data.credential.id);
      }

      toast.success(
        t(`API ${PROVIDER_INFO[selectedProvider]?.label || selectedProvider} adicionada com sucesso!`),
      );
      setApiKeyInput("");
      setModalOpen(false);
      await refreshApis();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("griot-apis-updated"));
    } catch {
      toast.success(
        t("API guardada localmente para utilização imediata."),
      );
      setApiKeyInput("");
      setModalOpen(false);
      await refreshApis();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("griot-apis-updated"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (api: ConnectedApiItem) => {
    try {
      if (api.isLocalOnly) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(`griot_api_key_${api.providerId}`);
          localStorage.removeItem(`griot_${api.providerId}_api_key`);
        }
      } else {
        await deleteGriotCredential(api.id);
      }
      toast.success(t(`API ${api.label} removida.`));
      await refreshApis();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("griot-apis-updated"));
    } catch {
      toast.error(t("Erro ao remover API."));
    }
  };

  return (
    <>
      <div className="panel overflow-hidden px-5 pt-4 pb-2">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {t("APIs")}
            </p>
            <p className="mt-1.5 text-[27px] leading-none font-semibold tracking-tight tabular-nums">
              {connectedApis.length}
              <span className="text-[14px] font-medium text-muted-foreground ml-1.5">
                {connectedApis.length === 1 ? t("ativa") : t("ativas")}
              </span>
            </p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {connectedApis.length > 0
                ? t("Orquestração de modelos pronta")
                : t("Nenhuma API ligada")}
            </p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
            <Cpu className="size-[17px] text-foreground/80" />
          </span>
        </div>

        {/* Lista de APIs ligadas ou Estado Vazio */}
        {connectedApis.length === 0 ? (
          <div className="my-4 rounded-2xl border border-hairline/70 bg-secondary/20 p-4 text-center">
            <div className="mx-auto grid size-8 place-items-center rounded-full bg-secondary/80 text-muted-foreground">
              <Key className="size-4" />
            </div>
            <p className="mt-2 text-[13.5px] font-medium text-foreground">
              {t("Nenhuma API ligada ainda")}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
              {t("Adiciona uma chave de API (Gemini, OpenAI, Claude, DeepSeek) para orquestrar respostas.")}
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {connectedApis.map((api) => (
              <li key={api.id} className="flex items-center gap-3 py-3">
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[12px] font-semibold text-foreground">
                  <span className="pulse-ring absolute inset-0 rounded-full bg-emerald-500/20" />
                  {api.short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-medium">{api.label}</span>
                    {api.secretHint && (
                      <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {api.secretHint}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {t("Ligada ·")} {api.hint}
                  </span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  <button
                    onClick={() => void handleDelete(api)}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title={t("Remover API")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Botão Elegante para Adicionar API no estilo refinado GRIOT */}
        <button
          onClick={() => setModalOpen(true)}
          className="group relative mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-hairline/80 bg-secondary/40 py-2.5 text-[13px] font-medium text-foreground transition-all duration-200 hover:bg-secondary hover:border-hairline active:scale-[0.98]"
        >
          <span className="grid size-5 place-items-center rounded-full bg-background border border-hairline transition-transform duration-200 group-hover:scale-110">
            <Plus className="size-3 text-foreground" />
          </span>
          <span>{t("Adicionar API")}</span>
        </button>

        {/* Link de Rodapé para Definições */}
        <Link
          to="/settings"
          className="-mx-5 mt-3 flex items-center justify-between border-t border-hairline px-5 py-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-secondary/30"
        >
          {t("Gerir Chaves de IA")}
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Modal / Dialog Elegante para Adicionar API */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
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
                onClick={() => setModalOpen(false)}
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

            {/* Input da Chave */}
            <div className="mt-4">
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
                className="mt-2 w-full rounded-2xl border border-hairline bg-background px-4 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground/60 focus:border-primary transition-colors"
                autoFocus
              />
            </div>

            {/* Ações */}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
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
      )}
    </>
  );
}

// Exportação compatível com o nome antigo para garantir retrocompatibilidade total
export const AcpPanel = ApisPanel;
