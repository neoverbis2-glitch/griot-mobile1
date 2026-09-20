/**
 * GRIOT User Saved APIs Manager
 *
 * Allows users to register multiple API keys even from the same provider
 * (e.g., 3 different Gemini keys, multiple OpenAI accounts, DeepSeek, etc.).
 * Persists locally in localStorage ('griot_user_apis') and synchronizes with Supabase.
 */

import { supabase } from "@/integrations/supabase/client";
import { saveGriotCredential, verifyGriotCredential, deleteGriotCredential } from "@/lib/griot-api";

export interface UserSavedApi {
  id: string;
  providerId:
    | "gemini"
    | "openai"
    | "claude"
    | "deepseek"
    | "groq"
    | "anthropic"
    | "elevenlabs"
    | "openrouter"
    | "grok"
    | "xai"
    | "perplexity"
    | "mistral"
    | "kimi"
    | "qwen"
    | "ollama"
    | "meta"
    | string;
  label: string;
  apiKey: string;
  model?: string;
  secretHint: string;
  status: "active" | "error";
  createdAt: string;
  remoteId?: string;
}

const STORAGE_KEY = "griot_user_apis";

const PROVIDER_DEFAULT_NAMES: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI GPT",
  claude: "Anthropic Claude",
  anthropic: "Anthropic Claude",
  deepseek: "DeepSeek",
  groq: "Groq Llama",
  elevenlabs: "ElevenLabs Voz",
  openrouter: "OpenRouter",
  grok: "xAI Grok",
  xai: "xAI Grok",
  perplexity: "Perplexity",
  mistral: "Mistral AI",
  kimi: "Moonshot Kimi",
  qwen: "Alibaba Qwen",
  ollama: "Ollama Local",
  meta: "Meta Llama",
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openrouter: "openrouter/auto",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o",
  claude: "claude-3-5-sonnet-latest",
  anthropic: "claude-3-5-sonnet-latest",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  grok: "grok-2-latest",
  xai: "grok-2-latest",
  perplexity: "sonar-pro",
  mistral: "mistral-large-latest",
  kimi: "moonshot-v1-auto",
  qwen: "qwen-plus",
  ollama: "llama3",
  meta: "llama-3.3-70b-versatile",
};

/** Carrega todas as APIs guardadas pelo utilizador */
export function getUserSavedApis(): UserSavedApi[] {
  if (typeof window === "undefined") return [];

  let list: UserSavedApi[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    }
  } catch (err) {
    console.warn("Erro ao ler griot_user_apis:", err);
  }

  // Higienização / Auto-cura de credenciais locais (OpenRouter e chaves com formato válido)
  let changed = false;
  for (const api of list) {
    if (api.providerId === "openrouter") {
      if (!api.model || api.model.includes("gemini-flash-latest")) {
        api.model = "openrouter/auto";
        changed = true;
      }
    }
    // Auto-cura: qualquer chave local com tamanho válido é considerada ativa para execução direta
    if (api.apiKey && api.apiKey.trim().length > 5 && api.status === "error") {
      api.status = "active";
      changed = true;
    }
  }
  if (changed && typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  // Migração/compatibilidade com chaves unitárias legadas (se não estiverem na lista)
  const legacyProviders = ["gemini", "openai", "claude", "deepseek", "groq", "elevenlabs", "openrouter", "grok", "xai", "mistral", "perplexity", "kimi", "qwen", "ollama"];
  for (const prov of legacyProviders) {
    const legacyVal =
      localStorage.getItem(`griot_api_key_${prov}`) ||
      localStorage.getItem(`griot_${prov}_api_key`) ||
      (prov === "gemini" ? localStorage.getItem("griot_api_key_google") || localStorage.getItem("griot_gemini_key") : null);

    if (legacyVal && legacyVal.trim().length > 5) {
      const exists = list.some((a) => a.apiKey === legacyVal.trim() || a.providerId === prov);
      if (!exists) {
        list.push({
          id: `local_${prov}_${Date.now()}`,
          providerId: prov as any,
          label: `${PROVIDER_DEFAULT_NAMES[prov] || prov} Principal`,
          apiKey: legacyVal.trim(),
          model: prov === "openrouter" ? "openrouter/auto" : undefined,
          secretHint: `••••${legacyVal.trim().slice(-4)}`,
          status: "active",
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return list;
}

/** Guarda ou adiciona uma nova API */
export async function saveUserApi(input: {
  providerId: string;
  apiKey: string;
  label?: string;
  model?: string;
}): Promise<UserSavedApi> {
  const apis = getUserSavedApis();
  const provider = input.providerId.toLowerCase() as UserSavedApi["providerId"];
  const trimmedKey = input.apiKey.trim();

  // Conta quantas APIs deste provedor já existem para numerar automaticamente se não houver rótulo
  const existingCount = apis.filter((a) => a.providerId === provider).length;
  const defaultLabel = `${PROVIDER_DEFAULT_NAMES[provider] || provider} #${existingCount + 1}`;
  const finalLabel = input.label?.trim() || defaultLabel;

  // Determina modelo padrão caso não venha informado
  let model = input.model?.trim();
  if (!model && PROVIDER_DEFAULT_MODELS[provider]) {
    model = PROVIDER_DEFAULT_MODELS[provider];
  } else if (provider === "openrouter" && (!model || model.includes("gemini-flash-latest"))) {
    model = "openrouter/auto";
  }

  const newApi: UserSavedApi = {
    id: `api_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    providerId: provider,
    label: finalLabel,
    apiKey: trimmedKey,
    model,
    secretHint: `••••${trimmedKey.slice(-4)}`,
    status: "active", // Ativo por padrão no dispositivo para chamada direta
    createdAt: new Date().toISOString(),
  };

  apis.push(newApi);

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
    // Mantém compatibilidade com helpers que leem chave única
    localStorage.setItem(`griot_api_key_${provider}`, trimmedKey);
    localStorage.setItem(`griot_${provider}_api_key`, trimmedKey);
    if (provider === "gemini") {
      localStorage.setItem("griot_api_key_google", trimmedKey);
      localStorage.setItem("griot_gemini_key", trimmedKey);
    }
    window.dispatchEvent(new Event("griot-apis-updated"));
  }

  // Tenta persistir e verificar no Supabase em segundo plano sem bloquear o uso local
  try {
    const backendProvider = provider === "claude" ? "anthropic" : provider;
    const res = await saveGriotCredential({
      providerId: backendProvider as any,
      secret: trimmedKey,
      label: finalLabel,
      model: input.model,
    });

    const remoteId = res.data?.credential?.id;
    if (remoteId) {
      newApi.remoteId = remoteId;
      const verification = await verifyGriotCredential(remoteId).catch(() => null);
      if (verification?.data?.valid === true) {
        newApi.status = "active";
      }
    }

    if (typeof window !== "undefined") {
      const idx = apis.findIndex((a) => a.id === newApi.id);
      if (idx !== -1) {
        apis[idx] = newApi;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
      }
      window.dispatchEvent(new Event("griot-apis-updated"));
    }
  } catch (err) {
    console.warn("[GRIOT] Sincronização de credencial remota ignorada (utilizando chave direta local):", err);
    // Mantém status "active" localmente para uso direto
    newApi.status = "active";
    if (typeof window !== "undefined") {
      const idx = apis.findIndex((a) => a.id === newApi.id);
      if (idx !== -1) {
        apis[idx] = newApi;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
      }
      window.dispatchEvent(new Event("griot-apis-updated"));
    }
  }

  return newApi;
}

/** Remove uma API específica por ID */
export async function deleteUserApi(apiId: string): Promise<void> {
  const apis = getUserSavedApis();
  const target = apis.find((a) => a.id === apiId);
  const remaining = apis.filter((a) => a.id !== apiId);

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));

    // Se era a única deste provedor, limpa a chave unitária
    if (target && !remaining.some((a) => a.providerId === target.providerId)) {
      localStorage.removeItem(`griot_api_key_${target.providerId}`);
      localStorage.removeItem(`griot_${target.providerId}_api_key`);
    } else if (target) {
      // Atualiza com a próxima chave disponível
      const next = remaining.find((a) => a.providerId === target.providerId);
      if (next) {
        localStorage.setItem(`griot_api_key_${target.providerId}`, next.apiKey);
        localStorage.setItem(`griot_${target.providerId}_api_key`, next.apiKey);
      }
    }

    window.dispatchEvent(new Event("griot-apis-updated"));
  }

  // Se tiver remoteId ou for UUID, tenta apagar no Supabase
  if (target?.remoteId) {
    try {
      await deleteGriotCredential(target.remoteId);
    } catch {}
  }
}

/** Procura uma API por ID ou pelo provedor */
export function findApiByIdOrProvider(idOrProvider: string): UserSavedApi | null {
  const apis = getUserSavedApis();
  if (!apis.length) return null;

  // 1. Procura por ID exato
  const byId = apis.find((a) => a.id === idOrProvider);
  if (byId) return byId;

  // 2. Procura por rótulo amigável exato (ex: "Dam", "Google Gemini")
  const byLabel = apis.find((a) => a.label?.toLowerCase() === idOrProvider.toLowerCase());
  if (byLabel) return byLabel;

  const normalized = idOrProvider.toLowerCase();

  // 3. Procura por provedor compatível
  const byProvider = apis.find(
    (a) =>
      a.providerId === normalized ||
      (normalized.includes("gemini") && a.providerId === "gemini") ||
      (normalized.includes("gpt") && a.providerId === "openai") ||
      (normalized.includes("openai") && a.providerId === "openai") ||
      ((normalized.includes("claude") || normalized.includes("anthropic")) &&
        (a.providerId === "claude" || a.providerId === "anthropic")) ||
      (normalized.includes("deepseek") && a.providerId === "deepseek") ||
      (normalized.includes("groq") && a.providerId === "groq") ||
      (normalized.includes("openrouter") && a.providerId === "openrouter") ||
      ((normalized.includes("grok") || normalized.includes("xai")) &&
        (a.providerId === "grok" || a.providerId === "xai")) ||
      (normalized.includes("mistral") && a.providerId === "mistral") ||
      (normalized.includes("perplexity") && a.providerId === "perplexity") ||
      (normalized.includes("kimi") && a.providerId === "kimi") ||
      (normalized.includes("qwen") && a.providerId === "qwen") ||
      (normalized.includes("ollama") && a.providerId === "ollama"),
  );
  if (byProvider) return byProvider;

  // 4. Se for ModelOS ou genérico, usa a melhor API disponível (prioridade Gemini)
  if (
    normalized === "modelos" ||
    normalized === "model-os" ||
    normalized === "default" ||
    !idOrProvider
  ) {
    const geminiApi = apis.find((a) => a.providerId === "gemini" && a.status === "active");
    if (geminiApi) return geminiApi;
    return apis.find((a) => a.status === "active") || apis[0] || null;
  }

  return null;
}
