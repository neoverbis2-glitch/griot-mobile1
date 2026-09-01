import { AI_CHAT_APPS } from "@/lib/settings";

export type ModelOption = {
  id: string;
  label: string;
  hint: string;
  isApp?: boolean;
  vendor?: string;
};

export const MODEL_OS_ID = "modelos";

export const BASE_CHAT_MODELS: ModelOption[] = [
  { id: "modelos", label: "ModelOS", hint: "ModelGPU RAL · Todas as IAs (Zero-API)", isApp: true },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 SOL", hint: "Raciocínio profundo" },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 TERRA", hint: "Equilíbrio" },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 LUNA", hint: "Velocidade" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash", hint: "Rápido e multimodal" },
];

export const QUICK_CHAT_MODELS: ModelOption[] = BASE_CHAT_MODELS;

export const DEFAULT_MODEL = "modelos";

export function isModelOS(id?: string): boolean {
  if (!id) return false;
  return (
    id === "modelos" ||
    id === "model-os" ||
    id === "ModelOS" ||
    id.toLowerCase().includes("modelos")
  );
}

export function getAvailableModels(prefs?: Record<string, unknown>): ModelOption[] {
  const list: ModelOption[] = [...BASE_CHAT_MODELS];

  // Apps de IA com Observer Invisível e Vinculação Fixa de Conversa
  for (const app of AI_CHAT_APPS) {
    const isExplicitlyDisabled = prefs && prefs[`app:${app.id}`] === false;
    if (!isExplicitlyDisabled) {
      const exists = list.some((m) => m.id === `app:${app.id}` || m.id === app.id);
      if (!exists) {
        list.push({
          id: `app:${app.id}`,
          label: app.label,
          hint: `Chat Fixo Invisível · ${app.vendor}`,
          isApp: true,
          vendor: app.vendor,
        });
      }
    }
  }

  return list;
}

export function modelLabel(id: string) {
  if (!id) return "ModelOS";
  if (isModelOS(id)) return "ModelOS";
  if (id.startsWith("app:")) {
    const appId = id.replace("app:", "");
    const app = AI_CHAT_APPS.find((a) => a.id === appId);
    if (app) return app.label;
  }
  const appDirect = AI_CHAT_APPS.find((a) => a.id === id);
  if (appDirect) return appDirect.label;
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
