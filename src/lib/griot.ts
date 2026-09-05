import { getUserSavedApis } from "@/lib/user-apis";

export type ModelOption = {
  id: string;
  label: string;
  hint: string;
  isApp?: boolean;
  vendor?: string;
};

export const MODEL_OS_ID = "modelos";

// Não há modelos de exemplo hardcoded — apenas as APIs reais adicionadas pelo utilizador
export const BASE_CHAT_MODELS: ModelOption[] = [];
export const QUICK_CHAT_MODELS: ModelOption[] = [];

export const DEFAULT_MODEL = "gemini-2.5-flash";

export function isModelOS(id?: string): boolean {
  if (!id) return false;
  return (
    id === "modelos" ||
    id === "model-os" ||
    id === "ModelOS" ||
    id.toLowerCase().includes("modelos")
  );
}

export function getAvailableModels(_prefs?: Record<string, unknown>): ModelOption[] {
  const userApis = getUserSavedApis();
  if (userApis.length === 0) {
    return [];
  }

  const options: ModelOption[] = [];

  // Se houver 2 ou mais APIs adicionadas, disponibiliza o orquestrador ModelOS
  if (userApis.length >= 2) {
    options.push({
      id: "modelos",
      label: "ModelOS",
      hint: "ModelGPU RAL · Orquestrador Multi-API",
      vendor: "griot",
    });
  }

  // Adiciona apenas as APIs reais adicionadas pelo utilizador
  for (const api of userApis) {
    options.push({
      id: api.id,
      label: api.label,
      hint: `${api.providerId.toUpperCase()} · ${api.secretHint}`,
      vendor: api.providerId,
    });
  }

  return options;
}

export function modelLabel(id: string) {
  if (!id) return "Selecionar API";
  if (isModelOS(id)) return "ModelOS";

  const userApis = getUserSavedApis();
  const match = userApis.find((a) => a.id === id);
  if (match) return match.label;

  if (id.includes("gemini")) return "Google Gemini";
  if (id.includes("gpt")) return "OpenAI GPT";
  if (id.includes("claude")) return "Anthropic Claude";
  if (id.includes("deepseek")) return "DeepSeek";
  if (id.includes("groq")) return "Groq Llama";

  return id;
}

export const CAPTURE_KINDS = [
  { id: "photo", label: "Foto" },
  { id: "video", label: "Vídeo" },
  { id: "document", label: "Documento" },
  { id: "audio", label: "Áudio" },
  { id: "screen", label: "Ecrã" },
  { id: "text", label: "Texto" },
  { id: "location", label: "Localização" },
] as const;

export type CaptureKind = (typeof CAPTURE_KINDS)[number]["id"];

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 6) return "Boa noite";
  if (hour < 13) return "Bom dia";
  if (hour < 20) return "Boa tarde";
  return "Boa noite";
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
}
