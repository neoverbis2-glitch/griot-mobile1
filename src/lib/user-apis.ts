/**
 * GRIOT User Saved APIs Manager
 *
 * Allows users to register multiple API keys even from the same provider
 * (e.g., 3 different Gemini keys, multiple OpenAI accounts, DeepSeek, etc.).
 * Persists locally in localStorage ('griot_user_apis') and synchronizes with Supabase.
 */

import { supabase } from "@/integrations/supabase/client";
import { saveGriotCredential, deleteGriotCredential } from "@/lib/griot-api";

export interface UserSavedApi {
  id: string;
  providerId: "gemini" | "openai" | "claude" | "deepseek" | "groq" | "anthropic";
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

  // Migração/compatibilidade com chaves unitárias legadas (se não estiverem na lista)
  const legacyProviders = ["gemini", "openai", "claude", "deepseek", "groq"];
  for (const prov of legacyProviders) {
    const legacyVal =
      localStorage.getItem(`griot_api_key_${prov}`) ||
      localStorage.getItem(`griot_${prov}_api_key`);

    if (legacyVal && legacyVal.trim().length > 5) {
      const exists = list.some((a) => a.apiKey === legacyVal || a.providerId === prov);
      if (!exists) {
        list.push({
          id: `local_${prov}_${Date.now()}`,
          providerId: prov as any,
          label: `${PROVIDER_DEFAULT_NAMES[prov] || prov} Principal`,
          apiKey: legacyVal.trim(),
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
  providerId: "gemini" | "openai" | "claude" | "deepseek" | "groq" | "anthropic";
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

  const newApi: UserSavedApi = {
    id: `api_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    providerId: provider,
    label: finalLabel,
    apiKey: trimmedKey,
    model: input.model,
    secretHint: `••••${trimmedKey.slice(-4)}`,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  apis.push(newApi);

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
    // Mantém compatibilidade com helpers que leem chave única
    localStorage.setItem(`griot_api_key_${provider}`, trimmedKey);
    localStorage.setItem(`griot_${provider}_api_key`, trimmedKey);
    window.dispatchEvent(new Event("griot-apis-updated"));
  }

  // Tenta guardar no Supabase em background
  try {
    const res = await saveGriotCredential({
      providerId: provider === "claude" ? "anthropic" : (provider as any),
      secret: trimmedKey,
      label: finalLabel,
      model: input.model,
    });
    if (res.data?.credential) {
      newApi.remoteId = res.data.credential.id;
      // atualiza o array com o remoteId
      const idx = apis.findIndex((a) => a.id === newApi.id);
      if (idx !== -1) {
        apis[idx] = newApi;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
      }
    }
  } catch {
    // continua normalmente com persistência local
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
  const byId = apis.find((a) => a.id === idOrProvider);
  if (byId) return byId;

  const normalized = idOrProvider.toLowerCase();
  const byProvider = apis.find(
    (a) =>
      a.providerId === normalized ||
      (normalized.includes("gemini") && a.providerId === "gemini") ||
      (normalized.includes("gpt") && a.providerId === "openai") ||
      (normalized.includes("claude") && (a.providerId === "claude" || a.providerId === "anthropic")) ||
      (normalized.includes("deepseek") && a.providerId === "deepseek") ||
      (normalized.includes("groq") && a.providerId === "groq"),
  );

  return byProvider || apis[0] || null;
}
