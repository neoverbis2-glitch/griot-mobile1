export const APP_LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "pt-PT", label: "Português (Portugal)" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "es-ES", label: "Español (España)" },
  { id: "es-419", label: "Español (Latinoamérica)" },
  { id: "fr-FR", label: "Français" },
  { id: "de-DE", label: "Deutsch" },
  { id: "it-IT", label: "Italiano" },
  { id: "nl-NL", label: "Nederlands" },
  { id: "pl-PL", label: "Polski" },
  { id: "uk-UA", label: "Українська" },
  { id: "ru-RU", label: "Русский" },
  { id: "tr-TR", label: "Türkçe" },
  { id: "ar", label: "العربية" },
  { id: "hi-IN", label: "हिन्दी" },
  { id: "zh-Hans", label: "中文 — Simplificado" },
  { id: "zh-Hant", label: "中文 — Tradicional" },
  { id: "ja-JP", label: "日本語" },
  { id: "ko-KR", label: "한국어" },
  { id: "id-ID", label: "Bahasa Indonesia" },
  { id: "vi-VN", label: "Tiếng Việt" },
  { id: "th-TH", label: "ไทย" },
  { id: "sw", label: "Kiswahili" },
  { id: "sv-SE", label: "Svenska" },
  { id: "nb-NO", label: "Norsk" },
  { id: "da-DK", label: "Dansk" },
  { id: "fi-FI", label: "Suomi" },
  { id: "cs-CZ", label: "Čeština" },
  { id: "ro-RO", label: "Română" },
  { id: "he-IL", label: "עברית" },
  { id: "ms-MY", label: "Bahasa Melayu" },
] as const;

export const NOTIFICATION_TYPES = [
  { id: "taskDone", label: "Tarefas concluídas" },
  { id: "approval", label: "Agentes que precisam de aprovação" },
  { id: "buildFailed", label: "Build falhou" },
  { id: "deployDone", label: "Deploy concluído" },
  { id: "projectError", label: "Projeto com erro" },
  { id: "longAnswer", label: "Resposta longa concluída" },
  { id: "nearLimit", label: "Uso próximo do limite" },
  { id: "criticalOnly", label: "Alertas críticos apenas" },
  { id: "quietHours", label: "Horário silencioso" },
] as const;

export const CONNECTIONS = [
  "GitHub",
  "Drive",
  "Gmail",
  "Calendar",
  "Vercel",
  "Cloudflare",
  "Backend GRIOT",
] as const;

export type Prefs = Record<string, string | boolean>;

const KEY = "griot-settings";

export const DEFAULT_PREFS: Prefs = {
  // Quick Chat
  saveHistory: true,
  temporaryByDefault: false,
  showModelHints: true,
  qualityMode: "Equilíbrio",
  attachmentBehavior: "Perguntar sempre",
  // Projetos
  autoSync: true,
  offlineDownloads: false,
  cacheRecent: true,
  confirmSendToProject: true,
  // Modelos
  hideUnusedModels: false,
  warnHeavyModels: true,
  fastModel: "GPT-5.6 LUNA",
  advancedModel: "GPT-5.6 SOL",
  // Uso
  monthlyLimit: "500 GCU",
  alerts75: true,
  alerts90: true,
  alerts100: true,
  computeSaver: false,
  // Voz
  voice: "GRIOT Nativa",
  voiceSpeed: "1.0×",
  voiceLanguage: "Português (Portugal)",
  autoSpeak: false,
  allowInterrupt: true,
  lockedScreenVoice: true,
  bluetooth: true,
  // Câmara & Capture
  mediaQuality: "Alta",
  stripLocation: true,
  autoCompress: true,
  autoDocScan: true,
  keepOriginal: false,
  // Privacidade
  permCamera: true,
  permMic: true,
  permPhotos: true,
  permLocation: false,
  permBluetooth: true,
  permContacts: false,
  permCalendar: false,
  shareWithProjects: true,
  localHistory: true,
  // Segurança
  biometrics: true,
  appPin: false,
  autoLock: "Após 5 min",
  requireAuthCritical: true,
  confirmCriticalActions: true,
  // Aparência
  appearance: "Sistema",
  accent: "GRIOT",
  textSize: "Padrão",
  reduceMotion: false,
  haptics: true,
  density: "Confortável",
  // Dados
  uploadQuality: "Automática",
  wifiOnlyUpload: false,
  mobileData: true,
  // Idioma & região
  appLanguage: "Português (Portugal)",
  answerLanguage: "Automático",
  dateFormat: "DD/MM/AAAA",
  region: "Portugal",
  currency: "EUR (€)",
  // Acessibilidade
  largeText: false,
  highContrast: false,
  reduceTransparency: false,
  reduceAnimations: false,
  captions: false,
  screenReader: true,
  extraHaptics: false,
  // Desktop
  allowRemoteTasks: true,
  allowWake: false,
  notifyDesktopOffline: true,
  // Advanced
  developerMode: false,
};

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return { ...DEFAULT_PREFS, ...(raw ? (JSON.parse(raw) as Prefs) : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("griot:prefs-changed", { detail: prefs }));
    window.dispatchEvent(new Event("storage"));
  }
}

/** Apps de Chat de IA Mobile suportados pelo GRIOT Observer. */
export const AI_CHAT_APPS = [
  { id: "chatgpt", label: "ChatGPT", short: "GPT", vendor: "OpenAI" },
  { id: "claude", label: "Claude", short: "CL", vendor: "Anthropic" },
  { id: "gemini", label: "Gemini", short: "GE", vendor: "Google" },
  { id: "deepseek", label: "DeepSeek", short: "DS", vendor: "DeepSeek" },
  { id: "kimi", label: "Kimi", short: "KM", vendor: "Moonshot AI" },
  { id: "grok", label: "Grok", short: "GR", vendor: "xAI" },
  { id: "perplexity", label: "Perplexity", short: "PX", vendor: "Perplexity" },
  { id: "mistral", label: "Le Chat", short: "LC", vendor: "Mistral AI" },
] as const;

export const ACP_CLIENTS = AI_CHAT_APPS;

export type AiChatAppId = (typeof AI_CHAT_APPS)[number]["id"];
export type AcpClientId = AiChatAppId;
