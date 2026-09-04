export type ModelOption = {
  id: string;
  label: string;
  hint: string;
  isApp?: boolean;
  vendor?: string;
};

export const MODEL_OS_ID = "modelos";

export const BASE_CHAT_MODELS: ModelOption[] = [
  { id: "modelos", label: "ModelOS", hint: "ModelGPU RAL · Orquestrador Multi-API" },
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "API Google · Rápido e multimodal" },
  { id: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "API Google · Raciocínio profundo" },
  { id: "openai/gpt-4o", label: "GPT-4o", hint: "API OpenAI · Alta precisão e lógica" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "API OpenAI · Veloz e eficiente" },
  { id: "anthropic/claude-3-5-sonnet", label: "Claude 3.5 Sonnet", hint: "API Anthropic · Código e escrita" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat", hint: "API DeepSeek · Lógica e matemática" },
];

export const QUICK_CHAT_MODELS: ModelOption[] = BASE_CHAT_MODELS;

export const DEFAULT_MODEL = "google/gemini-2.0-flash";

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
  return [...BASE_CHAT_MODELS];
}

export function modelLabel(id: string) {
  if (!id) return "Gemini 2.0 Flash";
  if (isModelOS(id)) return "ModelOS";
  return BASE_CHAT_MODELS.find((model) => model.id === id)?.label ?? id;
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
