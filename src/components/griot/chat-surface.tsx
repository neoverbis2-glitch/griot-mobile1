import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_MODEL, getAvailableModels, modelLabel, isModelOS } from "@/lib/griot";
import { getUserSavedApis } from "@/lib/user-apis";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";
import { AddApiModal } from "@/components/griot/add-api-modal";
import { toast } from "sonner";
import { Thinking } from "@/components/griot/thinking";
import { UserActions, AssistantActions } from "@/components/griot/message-actions";
import { ChatMessageItem } from "./chat-message-item";
import { MarkdownContent } from "./markdown-content";
import { ConversationDrawer, type Conversation } from "@/components/griot/chat-drawers";
import { labelFromLocale, useI18n, useT } from "@/lib/i18n";
import { VoiceSession } from "@/lib/voice-session";
import { transcribeAudioElite, resolveSpeechLanguage } from "@/lib/speech-transcriber";
import { loadPrefs } from "@/lib/settings";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { CapsulePanel } from "@/components/griot/capsule-panel";
import { useServerFn } from "@tanstack/react-start";
import {
  parseProposals,
  stripPartialBlock,
  type DecisionProposal,
  type EntityProposal,
} from "@/lib/capsule-proposals";
import { previewContext, proposeDecision, upsertEntity } from "@/lib/capsule.functions";
import { PluginBar, type PluginRequest } from "@/components/griot/plugin-bar";
import {
  PLUGINS,
  connectedPlugins,
  parsePluginCalls,
  pluginById,
  setPluginConnected,
  stripPartialPlugin,
} from "@/lib/plugins";
import {
  observerEngine,
  stripActionBlocks,
  modelGpuRalEngine,
} from "@/lib/runtime";
import { executeReActLoop } from "@/lib/runtime/react-loop";
import { getSavedApiKey, resolveProviderAndModel } from "@/lib/ai-client";
import { DeliberationBar } from "@/components/griot/deliberation-bar";
import {
  DELIBERATION_MISSIONS,
  DELIBERATION_ROLES,
  buildRoleSystemInstruction,
  type DeliberationMissionId,
  type DeliberationRoleId,
  type GriotVerdict,
} from "@/lib/runtime/deliberation-room";
import { getWorkspaceFiles, type WorkspaceFile } from "@/lib/runtime/local-harness";
import {
  getUnifiedProjects,
  getActiveProjectSync,
  setActiveProject,
  type GriotProject,
} from "@/lib/project-service";

import {
  ArrowUp,
  AudioLines,
  Mic,
  Camera,
  ImageIcon,
  Paperclip,
  Puzzle,
  Plus,
  Square,
  Check,
  X,
  ChevronDown,
  Share2,
  Pin,
  FolderPlus,
  Archive,
  Trash2,
  ChevronLeft,
  Play,
  Terminal,
  CloudLightning,
  Menu,
  MoreVertical,
  Folder,
  Brain,
  ShieldAlert,
  BarChart2,
  CheckCircle2,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { getAiLogo, GriotAiLogo } from "@/components/griot/brand-icons";
import { PluginsView } from "@/components/griot/plugins-view";

import {
  captureAsText,
  captureTitle,
  exactDateTime,
  listQuickCaptures,
  captureUrl,
  type CaptureRow,
} from "@/lib/capture-share";
import { getStoredCaptures, saveCapture } from "@/lib/capture-service";


type Row = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  feedback?: string | null;
};

const EFFORTS = [
  { id: "low", label: "Rápido", hint: "Respostas curtas e imediatas" },
  { id: "medium", label: "Equilibrado", hint: "O padrão do GRIOT" },
  { id: "high", label: "Profundo", hint: "Mais tempo a pensar" },
] as const;

type Effort = (typeof EFFORTS)[number]["id"];
type Sheet = null | "plus" | "model" | "actions" | "projects" | "captures";

/** Vozes das Definições → vozes reais de síntese. */
const TTS_VOICES: Record<string, string> = {
  "GRIOT Nativa": "alloy",
  Serena: "nova",
  Grave: "onyx",
  Neutra: "fable",
};

const SPEECH_SPEEDS: Record<string, number> = {
  "0.8×": 0.85,
  "1.0×": 1.0,
  "1.2×": 1.2,
  "1.5×": 1.45,
};

function triggerHaptic(type: "light" | "medium" | "heavy" | "selection" = "light") {
  try {
    const prefs = loadPrefs();
    if (prefs["haptics"] === false) return;
    if (type === "selection") {
      void Haptics.selectionChanged().catch(() => undefined);
    } else {
      const style =
        type === "heavy"
          ? ImpactStyle.Heavy
          : type === "medium"
            ? ImpactStyle.Medium
            : ImpactStyle.Light;
      void Haptics.impact({ style }).catch(() => undefined);
    }
  } catch {}
}

function generatePreviewSrcDoc(files: WorkspaceFile[]): string {
  const htmlFile = files.find((f) => f.path.endsWith(".html") || f.path === "index.html") || files[0];
  if (!htmlFile) {
    return "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:20px;color:#888;'><h3>Nenhum ficheiro HTML no workspace.</h3></body></html>";
  }
  let doc = htmlFile.content;
  for (const f of files) {
    if (f.path.endsWith(".css")) {
      if (doc.includes("</head>")) {
        doc = doc.replace("</head>", `<style>${f.content}</style></head>`);
      } else {
        doc = `<style>${f.content}</style>` + doc;
      }
    }
    if (f.path.endsWith(".js") && !f.path.endsWith(".test.js")) {
      if (doc.includes("</body>")) {
        doc = doc.replace("</body>", `<script>${f.content}</script></body>`);
      } else {
        doc = doc + `<script>${f.content}</script>`;
      }
    }
  }
  return doc;
}

interface QuickPersonaSegment {
  roleRaw: string;
  content: string;
}

function parseQuickSegments(raw: string): QuickPersonaSegment[] {
  const personaRegex =
    /(?:^|\n)\s*(?:\*{1,2}|\[)?\s*(Estrategista|Crítico|Critico|Analista|Inovador|Sintetizador|Veredito|Strategist|Critic|Analyst|Innovator)\s*(?:\*{1,2}|\])?\s*:\s*(?:\*{1,2})?\s*/gi;
  const matches = [...raw.matchAll(personaRegex)];
  if (matches.length === 0) {
    return [{ roleRaw: "griot", content: raw.trim() }];
  }
  const segments: QuickPersonaSegment[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const startIndex = cur.index + cur[0].length;
    const endIndex = next ? next.index : raw.length;
    const content = raw.substring(startIndex, endIndex).trim();
    const roleRaw = cur[1];
    if (content.length > 0) {
      segments.push({ roleRaw, content });
    }
  }
  return segments.length > 0 ? segments : [{ roleRaw: "griot", content: raw.trim() }];
}

interface QuickPersonaConfig {
  name: string;
  badge: string;
  avatarBg: string;
  icon: React.ReactNode;
}

function getPersonaConfig(roleRaw: string): QuickPersonaConfig {
  const r = roleRaw.toLowerCase();
  if (r.includes("estrateg") || r.includes("strateg")) {
    return {
      name: "O Estrategista",
      badge: "Visão & Produto",
      avatarBg: "bg-blue-500/15 border-blue-500/30 text-blue-500",
      icon: <Brain className="size-4.5" />,
    };
  }
  if (r.includes("crític") || r.includes("critic")) {
    return {
      name: "O Crítico",
      badge: "Desafios & Riscos",
      avatarBg: "bg-rose-500/15 border-rose-500/30 text-rose-500",
      icon: <ShieldAlert className="size-4.5" />,
    };
  }
  if (r.includes("analist") || r.includes("analyst")) {
    return {
      name: "O Analista",
      badge: "Técnica & Métricas",
      avatarBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-500",
      icon: <BarChart2 className="size-4.5" />,
    };
  }
  if (r.includes("inovad") || r.includes("innovat")) {
    return {
      name: "O Inovador",
      badge: "Diferenciação & Ideias",
      avatarBg: "bg-purple-500/15 border-purple-500/30 text-purple-500",
      icon: <Lightbulb className="size-4.5" />,
    };
  }
  if (r.includes("vered") || r.includes("sintet")) {
    return {
      name: "Veredito da Sala",
      badge: "Conclusão Final",
      avatarBg: "bg-amber-500/15 border-amber-500/30 text-amber-500",
      icon: <CheckCircle2 className="size-4.5" />,
    };
  }
  return {
    name: "GRIOT Deliberation",
    badge: "Orquestrador",
    avatarBg: "bg-secondary border-hairline text-foreground",
    icon: <Sparkles className="size-4.5" />,
  };
}

function saveConversationLocally(conv: Conversation) {
  if (typeof window === "undefined" || !conv?.id) return;
  try {
    const raw = localStorage.getItem("griot_conversations_v1");
    const list: Conversation[] = raw ? JSON.parse(raw) : [];
    const index = list.findIndex((c) => c.id === conv.id);
    const scopeKey = conv.scope === "quick" ? "quick" : "main";
    const normalizedConv = { ...conv, scope: scopeKey, updated_at: new Date().toISOString() };
    if (index >= 0) {
      list[index] = { ...list[index], ...normalizedConv };
    } else {
      list.unshift(normalizedConv);
    }
    localStorage.setItem("griot_conversations_v1", JSON.stringify(list));
    localStorage.setItem("griot_active_" + scopeKey + "_conv_id", conv.id);
    window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
  } catch {}
}

export function ChatSurface({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useI18n();
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [scope, setScope] = useState<"main" | "quick">("main");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("griot-default-model");
      if (stored) return stored;
    }
    return DEFAULT_MODEL;
  });
  const [effort, setEffort] = useState<Effort>("medium");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pluginsViewOpen, setPluginsViewOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const [projects, setProjects] = useState<GriotProject[]>([]);
  const [activeProject, setActiveProjectState] = useState<GriotProject | null>(() => getActiveProjectSync());
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [deliberationMission, setDeliberationMission] = useState<DeliberationMissionId>("ideate");
  const [roleEngines, setRoleEngines] = useState<Record<DeliberationRoleId, string>>(() => {
    const saved = getUserSavedApis();
    if (saved.length > 0) {
      return {
        strategist: saved[0]?.id || "gemini",
        analyst: saved[1]?.id || saved[0]?.id || "gemini",
        innovator: saved[2]?.id || saved[0]?.id || "gemini",
        critic: saved[0]?.id || "gemini",
      };
    }
    return {
      strategist: "gemini",
      analyst: "gemini",
      innovator: "gemini",
      critic: "gemini",
    };
  });
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 22 }, () => 0.12));
  const [seconds, setSeconds] = useState(0);
  const [voiceChat, setVoiceChat] = useState(false);
  const [voiceState, setVoiceState] = useState<"listening" | "thinking" | "speaking">("listening");
  const [voiceText, setVoiceText] = useState("");
  const [voiceDraft, setVoiceDraft] = useState("");

  const [apisRevision, setApisRevision] = useState(0);
  const availableModels = useMemo(() => getAvailableModels(prefs), [prefs, apisRevision]);
  const [addApiModalOpen, setAddApiModalOpen] = useState(false);

  // Integração com Local Workspace e Google Cloud Shell
  const [cloudShellRequired, setCloudShellRequired] = useState(false);
  const [cloudShellCmd, setCloudShellCmd] = useState("");
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);

  useEffect(() => {
    const wsId = conversation?.id || "default";
    setWorkspaceFiles(getWorkspaceFiles(wsId));

    const onCloudShellRequired = (e: any) => {
      setCloudShellRequired(true);
      setCloudShellCmd(e.detail?.action?.params?.command || "");
    };
    const onFilesUpdated = () => {
      setWorkspaceFiles(getWorkspaceFiles(wsId));
    };

    window.addEventListener("griot:cloudshell-required", onCloudShellRequired);
    window.addEventListener("griot:workspace-files-updated", onFilesUpdated);
    return () => {
      window.removeEventListener("griot:cloudshell-required", onCloudShellRequired);
      window.removeEventListener("griot:workspace-files-updated", onFilesUpdated);
    };
  }, [conversation?.id]);

  const handleConnectGoogleCloud = async () => {
    setConnectingGoogle(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.href : undefined,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
          scopes: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email",
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("Erro ao ligar ao Google Cloud."));
    } finally {
      setConnectingGoogle(false);
    }
  };

  useEffect(() => {
    const handlePrefsChange = () => setPrefs(loadPrefs());
    const handleApisUpdate = () => setApisRevision((v) => v + 1);
    window.addEventListener("storage", handlePrefsChange);
    window.addEventListener("griot:prefs-changed", handlePrefsChange);
    window.addEventListener("focus", handlePrefsChange);
    window.addEventListener("griot-apis-updated", handleApisUpdate);
    return () => {
      window.removeEventListener("storage", handlePrefsChange);
      window.removeEventListener("griot:prefs-changed", handlePrefsChange);
      window.removeEventListener("focus", handlePrefsChange);
      window.removeEventListener("griot-apis-updated", handleApisUpdate);
    };
  }, []);

  // Seleciona a primeira API adicionada se o modelo selecionado não for válido
  useEffect(() => {
    if (availableModels.length > 0) {
      if (!model || !availableModels.some((m) => m.id === model)) {
        setModel(availableModels[0].id);
      }
    }
  }, [availableModels, model]);

  useEffect(() => {
    (window as any).griotHandleBackButton = () => {
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (drawer) {
        setDrawer(false);
        return true;
      }
      void navigate({ to: "/home" });
      return true;
    };
    return () => {
      delete (window as any).griotHandleBackButton;
    };
  }, [sheet, drawer, navigate]);

  const [drag, setDrag] = useState(0);
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [proposals, setProposals] = useState<(DecisionProposal | EntityProposal)[]>([]);
  const [plugin, setPlugin] = useState<PluginRequest | null>(null);
  const pluginBase = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const compileContext = useServerFn(previewContext);
  const addDecision = useServerFn(proposeDecision);
  const addEntity = useServerFn(upsertEntity);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const touchRef = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const dragMeta = useRef({ last: 0, time: 0, velocity: 0, active: false });
  const frame = useRef<number | null>(null);

  const recognitionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const lastAnswerRef = useRef("");
  const sessionRef = useRef<VoiceSession | null>(null);
  // Callbacks da sessão de voz vivem para lá de um render: estes refs garantem
  // que cada turno usa o histórico e as funções mais recentes.
  const messagesRef = useRef<Row[]>([]);
  const conversationRef = useRef<Conversation | null>(null);
  conversationRef.current = conversation;
  const scopeRef = useRef<"main" | "quick">(scope);
  scopeRef.current = scope;
  const sendRef = useRef<typeof send | null>(null);
  const runRef = useRef<typeof run | null>(null);

  const audioRef = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    analyser: AnalyserNode;
    raf: number;
  } | null>(null);

  async function startMeter() {
    if (audioRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const bars = 22;
      const meter = () => {
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / bars);
        const next: number[] = [];
        for (let index = 0; index < bars; index += 1) {
          let sum = 0;
          for (let offset = 0; offset < step; offset += 1) sum += data[index * step + offset] ?? 0;
          const value = sum / step / 255;
          next.push(Math.min(1, 0.1 + Math.pow(value, 0.65) * 1.6));
        }
        setLevels(next);
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(meter);
      };
      audioRef.current = { ctx, stream, analyser, raf: 0 };
      audioRef.current.raf = requestAnimationFrame(meter);
    } catch {
      // sem acesso ao microfone: mantém as barras em repouso
    }
  }

  function stopMeter() {
    const audio = audioRef.current;
    audioRef.current = null;
    if (!audio) return;
    cancelAnimationFrame(audio.raf);
    audio.stream.getTracks().forEach((track) => track.stop());
    void audio.ctx.close();
    setLevels(Array.from({ length: 22 }, () => 0.12));
  }

  useEffect(() => () => stopMeter(), []);

  const conversationId = conversation?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 1. Tenta carregar do localStorage a conversa activa do escopo padrão ("main")
      let localConv: Conversation | null = null;
      if (typeof window !== "undefined") {
        try {
          const activeId = localStorage.getItem("griot_active_main_conv_id");
          const raw = localStorage.getItem("griot_conversations_v1");
          if (raw) {
            const list: Conversation[] = JSON.parse(raw);
            if (activeId) {
              localConv = list.find((c) => c.id === activeId && !c.archived && (c.scope || "main") === "main") || null;
            }
            if (!localConv) {
              localConv = list.find((c) => (c.scope || "main") === "main" && !c.archived) || null;
            }
          }
        } catch {}
      }

      if (localConv) {
        if (!cancelled) {
          setConversation(localConv);
          setModel(localConv.model || DEFAULT_MODEL);
        }
        return;
      }

      // 2. Se não encontrou no local, busca do Supabase
      try {
        const { data: existing } = await (supabase as any)
          .from("griot_conversations")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(15);

        let matched: Conversation | null = null;
        if (existing && existing.length > 0) {
          let localMap: Record<string, any> = {};
          if (typeof window !== "undefined") {
            try {
              const raw = localStorage.getItem("griot_conversations_v1");
              if (raw) {
                for (const item of JSON.parse(raw)) {
                  if (item?.id) localMap[item.id] = item;
                }
              }
            } catch {}
          }
          const candidate = existing.find((c: any) => {
            const loc = localMap[c.id];
            const itemScope = loc?.scope || "main";
            return itemScope === "main" && !loc?.archived;
          });
          if (candidate) {
            matched = {
              id: candidate.id,
              scope: "main",
              title: candidate.title || "Conversa Principal",
              model: DEFAULT_MODEL,
              pinned: false,
              archived: false,
              updated_at: candidate.updated_at,
            };
          }
        }

        if (matched) {
          if (!cancelled) {
            setConversation(matched);
            setModel(matched.model || DEFAULT_MODEL);
            saveConversationLocally(matched);
          }
          return;
        }

        if (!cancelled) {
          await newConversation("main");
        }
      } catch {
        if (!cancelled) {
          await newConversation("main");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;

    // Cache local imediato para não piscar mensagens de outra conversa
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("griot_messages_" + conversationId);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setMessages(parsed);
          else setMessages([]);
        } else {
          setMessages([]);
        }
      } catch {
        setMessages([]);
      }
    }

    void (supabase as any)
      .from("griot_messages")
      .select("id, actor_kind, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .then(({ data }: any) => {
        if (!cancelled && data) {
          const mapped: Row[] = data.map((m: any) => ({
            id: m.id,
            role: m.actor_kind === "human" ? "user" : m.actor_kind === "model" ? "assistant" : "system",
            content: m.content,
            created_at: m.created_at,
            feedback: null,
          }));
          if (mapped.length > 0) {
            setMessages(mapped);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem("griot_messages_" + conversationId, JSON.stringify(mapped));
              } catch {}
            }
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Escuta streaming de app externa vinculada caso chegue via Observer Nativo (Android/Accessibility)
  useEffect(() => {
    const handleNativeChunk = (e: any) => {
      const detail = e.detail;
      if (detail?.text && busy) {
        setStreaming(detail.text);
      }
    };
    window.addEventListener("griot:app-stream-chunk", handleNativeChunk);
    return () => window.removeEventListener("griot:app-stream-chunk", handleNativeChunk);
  }, [busy]);

  // A Cápsula vive por conversa e só no Chat (não no Quick).
  useEffect(() => {
    if (!conversationId || scope !== "main") {
      setCapsuleId(null);
      setCapsuleOpen(false);
      setProposals([]);
      return;
    }
    let cancelled = false;
    setProposals([]);
    setCapsuleId(null);
    return () => {
      cancelled = true;
    };
  }, [conversationId, scope]);

  /** Aprovar uma proposta escreve-a no Canon / nas entidades da Cápsula. */
  async function approve(proposal: DecisionProposal | EntityProposal) {
    if (!capsuleId) return;
    try {
      if ("title" in proposal) {
        await addDecision({
          data: {
            capsuleId,
            title: proposal.title,
            ...(proposal.description ? { description: proposal.description } : {}),
            ...(proposal.section ? { section: proposal.section } : {}),
            proposedBy: "user" as const,
            autoApprove: true,
            idempotencyKey: `${conversationId}-${proposal.key}`,
          },
        });
      } else {
        await addEntity({
          data: {
            capsuleId,
            name: proposal.name,
            entityType: proposal.entity_type,
            ...(proposal.description ? { description: proposal.description } : {}),
          },
        });
      }
      setProposals((current) => current.filter((row) => row.key !== proposal.key));
      toast.success(t("Cápsula atualizada."));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  // Continuidade: qualquer mensagem escrita noutro dispositivo aparece aqui.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as Row;
          setMessages((current) =>
            current.some((m) => m.id === row.id) ? current : [...current, row],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming, reasoning]);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    let cancelled = false;
    async function fetchProjects() {
      try {
        const unified = await getUnifiedProjects();
        if (cancelled) return;
        setProjects(unified);
        const active = getActiveProjectSync();
        setActiveProjectState(active);
      } catch (err) {
        console.warn("Falha ao carregar projetos no Chat:", err);
      }
    }
    void fetchProjects();

    const onProjectChanged = () => {
      const active = getActiveProjectSync();
      setActiveProjectState(active);
    };
    window.addEventListener("griot-active-project-changed", onProjectChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("griot-active-project-changed", onProjectChanged);
    };
  }, [sheet]);

  // Capture no “+”: primeiro as marcadas como rápidas, depois as mais recentes.
  useEffect(() => {
    if (sheet !== "captures") return;
    void getStoredCaptures().then((stored) => {
      const rows = (stored ?? []) as unknown as CaptureRow[];
      const quick = listQuickCaptures();
      setCaptures(
        [...rows].sort((a, b) => {
          const rank = (id: string) => {
            const index = quick.indexOf(id);
            return index === -1 ? 999 : index;
          };
          return rank(a.id) - rank(b.id);
        }),
      );
    });
  }, [sheet]);

  async function sendCapture(capture: CaptureRow) {
    if (!conversationId) return;
    const content = await captureAsText(capture);
    void send(content);
    toast.success(t("Captura adicionada à conversa."));
    setSheet(null);
  }

  const empty = messages.length === 0 && !streaming && !reasoning;

  const history = useMemo(
    () => messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    [messages],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      abortRef.current = null;
    }
    setBusy(false);
    setStreaming("");
    setReasoning("");
    setSteps(0);
  }, []);

  async function run(
    base: { role: "user" | "assistant"; content: string }[],
    options?: { effort?: Effort; voice?: boolean },
  ) {
    if (!conversationId) return;
    const activeEffort = options?.effort ?? effort;
    const voiceMode = options?.voice === true;

    // 1. Verificação prévia de chave no ambiente móvel para evitar congelamentos
    const activeModel = model;
    const { provider, specificApiKey } = resolveProviderAndModel(activeModel);
    const effectiveKey = specificApiKey || getSavedApiKey(provider) || getSavedApiKey("gemini");
    const isLocalApp =
      typeof window !== "undefined" &&
      (window.location.protocol === "capacitor:" ||
        window.location.hostname === "localhost" ||
        Boolean((window as any).Capacitor?.isNativePlatform?.()));

    if (!effectiveKey && isLocalApp) {
      setBusy(false);
      setStreaming("");
      const needKeyMsg: Row = {
        id: `asst-key-${Date.now()}`,
        role: "assistant",
        content: `👋 **Olá! Para conversares com o GRIOT, precisas de ligar uma chave de API.**\n\nA forma mais rápida e gratuita é utilizar a chave do **Google Gemini**:\n\n1. Obtém a tua chave gratuita no [Google AI Studio](https://aistudio.google.com/apikey).\n2. Insere a chave na janela que se abriu (ou acede a **Definições → Chave Google Gemini**).\n\nAssim que inserires a tua chave, todas as tuas conversas, deliberação no modo Quick e os agentes funcionarão em tempo real!`,
        created_at: new Date().toISOString(),
        feedback: null,
      };
      setMessages((current) => {
        const updated = [...current, needKeyMsg];
        if (typeof window !== "undefined" && conversationId) {
          try {
            localStorage.setItem("griot_messages_" + conversationId, JSON.stringify(updated));
          } catch {}
        }
        return updated;
      });
      setAddApiModalOpen(true);
      return;
    }

    const targetConvId = conversationId;
    const targetScope = scope;

    setBusy(true);
    setStreaming("");
    setReasoning("");
    setSteps(0);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";

    // No modo rápido e em voz não há compilação de contexto: o objetivo é latência mínima.
    let context: string | undefined;
    if (capsuleId && !voiceMode && activeEffort !== "low") {
      try {
        const compiled = await compileContext({
          data: { capsuleId, query: base[base.length - 1]?.content?.slice(0, 500) ?? "" },
        });
        context = compiled?.text;
      } catch {
        context = undefined;
      }
    }

    // Identificar o projeto associado à conversa ou o projeto ativo global
    const currentProject =
      projects.find((p) => p.id === conversation?.project_id) || activeProject;

    let sysInstruction =
      "És o GRIOT, o assistente de engenharia de software e inteligência artificial de elite. Quando precisares de inspecionar ou modificar ficheiros ou executar comandos, utiliza as ferramentas disponíveis.";

    if (currentProject) {
      sysInstruction += `\n\n[PROJETO ATIVO GRIOT]
Nome do Projeto: ${currentProject.name}
ID: ${currentProject.id}
Descrição: ${currentProject.description || "Projeto GRIOT Mobile"}
Progresso: ${currentProject.progress}%
Status: ${currentProject.status || "ativo"}
NOTA CRÍTICA: Tu estás explicitamente a operar no contexto do projeto "${currentProject.name}". Quando o utilizador te perguntar se o chat está num projeto, qual é o projeto ou sobre o status do projeto, confirma com clareza e autoridade que estás a operar no projeto "${currentProject.name}" e cita estes detalhes.`;
    } else {
      sysInstruction += `\n\n[PROJETO ATIVO GRIOT]
Nenhum projeto específico está associado a esta sessão (conversa geral).`;
    }

    if (scope === "quick") {
      const missionObj =
        DELIBERATION_MISSIONS.find((m) => m.id === deliberationMission) || DELIBERATION_MISSIONS[0];
      sysInstruction += `\n\n[MODO QUICK DELIBERATION ROOM]
Missão Ativa: ${missionObj.label} (${missionObj.description})
Atua como um grupo dinâmico de deliberação e debate. Divide a tua intervenção entre os intervenientes relevantes identificando cada um pelo nome, por exemplo:
**Estrategista:** (visão de produto e valor de mercado)
**Crítico:** (atrito, riscos e pontos cegos)
**Analista:** (técnica, dados e custos)
**Inovador:** (novas ideias e diferenciação criativa)
**Veredito:** (síntese conclusiva e recomendação acionável)
Cada membro deve ser conciso, direto e falar na sua voz própria, como membros de uma equipa num grupo de rede social.`;
    }

    if (opts?.voice || voiceChat) {
      const prefs = loadPrefs();
      const langInfo = resolveSpeechLanguage((prefs["voiceLanguage"] as string) || (prefs["appLanguage"] as string));
      sysInstruction += `\n\n[MODO DE CONVERSAÇÃO POR VOZ EM TEMPO REAL]
Estás numa chamada de voz falada direta com o utilizador em tempo real.
DIRETRIZES ESTRITAS DE FALA HUMANA:
- Responde SEMPRE em linguagem falada fluida, natural, concisa e humana no idioma ${langInfo.name} (${langInfo.bcp47}).
- Sê direto: responde habitualmente em 1 a 3 frases bem articuladas.
- NUNCA uses formatações de escrita Markdown: sem títulos (#), sem asteriscos (**negrito**), sem numeração mecânica, sem bullet points (-), sem blocos de código nem tabelas.
- NUNCA emitas tags de raciocínio como <think> ou explicações do sistema.
- Converte números e símbolos em texto falado (ex: diz "vinte por cento" em vez de 20%, "cinquenta euros" em vez de 50€).
- Fala de forma expressiva, amigável e conversacional, como uma pessoa ao telefone.`;
    }

    if (!context && currentProject) {
      context = `Projeto: ${currentProject.name}\nDescrição: ${currentProject.description || "GRIOT Mobile"}\nProgresso: ${currentProject.progress}%\nEstado: ${currentProject.status || "ativo"}`;
    }

    try {
      const lastMsg = base[base.length - 1]?.content || "";
      const mLabel = modelLabel(model);

      let streamedAny = false;
      try {
        const loopResult = await executeReActLoop({
          modelId: model,
          messages: base,
          systemInstruction: sysInstruction,
          context,
          maxIterations: targetScope === "quick" ? 1 : 2,
          callbacks: {
            onToken: (token) => {
              if (conversationRef.current?.id !== targetConvId) return;
              answer += token;
              setStreaming(answer);
              streamedAny = true;
              if (voiceMode) sessionRef.current?.feed(token);
            },
            onReasoning: (r) => {
              if (conversationRef.current?.id !== targetConvId) return;
              setReasoning((current) => current + r);
            },
            onStepChange: (step) => {
              if (conversationRef.current?.id !== targetConvId) return;
              setSteps(step);
            },
          },
          signal: controller.signal,
        });

        if (loopResult.finalAnswer) {
          answer = loopResult.finalAnswer;
          if (conversationRef.current?.id === targetConvId) {
            setStreaming(answer);
          }
          streamedAny = true;
        }
      } catch (aiErr: any) {
        console.warn("Execução de IA direta/orquestrada falhou:", aiErr);
        toast.error(
          aiErr?.message ||
            `Sem ligação ao modelo ${mLabel}. Adiciona a tua chave de API em Definições → Chave Google Gemini para conversar.`,
        );
        if (!streamedAny || !answer.trim()) {
          answer = `⚠️ **Não foi possível obter resposta do modelo ${mLabel}.**\n\n${aiErr?.message || "Ocorreu uma falha na ligação com o fornecedor de IA."}\n\n👉 Verifica a tua ligação à rede e a tua chave em **Definições → Chave Google Gemini**.`;
          streamedAny = true;
        }
      }

      if (!streamedAny || !answer.trim()) {
        setBusy(false);
        setStreaming("");
        return;
      }

      const parsed = parseProposals(answer);
      const found = [...parsed.decisions, ...parsed.entities];
      if (found.length > 0 && capsuleId) setProposals(found);
      answer = parsed.clean || answer;

      // Pedidos de plugin: barra de permissão (ou uso direto, se já estiver ligado).
      const tools = parsePluginCalls(answer);
      if (tools.calls.length > 0 && !voiceMode) {
        answer = tools.clean || answer;
        const call = tools.calls[0]!;
        const connected = connectedPlugins().includes(call.id);
        pluginBase.current = [...base, { role: "assistant", content: answer }];
        const request: PluginRequest = {
          ...call,
          connected,
          state: connected ? "running" : "asking",
        };
        setPlugin(request);
        if (connected) void executePlugin(request);
      }
      // Process actions through GRIOT Observer & Command Engine
      let appKey = "custom";
      if (isModelOS(model)) {
        appKey = "modelos";
        // Dispara o workload cognitivo descentralizado no ModelGPU RAL (distribui por todas as IAs)
        void modelGpuRalEngine.dispatchComputeWorkload({
          prompt: base[base.length - 1]?.content || answer,
          title: conversation?.title || "ModelOS Workload",
          affinity: "code_generation",
        });
      } else {
        appKey = model.toLowerCase().includes("claude")
          ? "claude"
          : model.toLowerCase().includes("gemini")
            ? "gemini"
            : model.toLowerCase().includes("gpt")
              ? "chatgpt"
              : model.toLowerCase().includes("deepseek")
                ? "deepseek"
                : model.toLowerCase().includes("kimi")
                  ? "kimi"
                  : model.toLowerCase().includes("grok")
                    ? "grok"
                    : model.toLowerCase().includes("perplexity") ||
                        model.toLowerCase().includes("sonar")
                      ? "perplexity"
                      : model.toLowerCase().includes("mistral") ||
                          model.toLowerCase().includes("codestral")
                        ? "mistral"
                        : "custom";
      }

      try {
        void observerEngine.processIncomingAIMessage(
          {
            provider: appKey as any,
            model,
            sessionTitle:
              conversation?.title ||
              (isModelOS(model) ? "ModelOS Cluster" : "Sessão Ativa"),
            appId: appKey,
          },
          answer,
          conversationId || "main",
        );
      } catch (obsErr) {
        console.warn("[GRIOT] Observer non-critical warning:", obsErr);
      }

      lastAnswerRef.current = answer;

      if (answer.trim()) {
        let row: Row | null = null;
        try {
          const workspaceId = await getPrimaryWorkspaceId(userId);
          const { data: saved } = await (supabase as any)
            .from("griot_messages")
            .insert({
              workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
              conversation_id: targetConvId,
              actor_kind: "model",
              content: answer,
              status: "succeeded",
              metadata: { model },
            })
            .select("id, actor_kind, content, created_at")
            .single();
          if (saved) {
            row = {
              id: saved.id,
              role: "assistant",
              content: saved.content,
              created_at: saved.created_at,
              feedback: null,
            };
          }
        } catch {
          // ignore
        }
        if (!row) {
          row = {
            id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            content: answer,
            created_at: new Date().toISOString(),
            feedback: null,
          };
        }

        // Guarda sempre localmente no cache da conversa de destino
        if (typeof window !== "undefined" && targetConvId) {
          try {
            const rawStored = localStorage.getItem("griot_messages_" + targetConvId);
            const currentList: Row[] = rawStored ? JSON.parse(rawStored) : [];
            if (!currentList.some((m) => m.id === row!.id)) {
              currentList.push(row!);
              localStorage.setItem("griot_messages_" + targetConvId, JSON.stringify(currentList));
            }
          } catch {}
        }

        // Só atualiza o estado em memória se a conversa ativa no momento for a de destino
        if (conversationRef.current?.id === targetConvId) {
          setMessages((current) => {
            return current.some((m) => m.id === row!.id) ? current : [...current, row!];
          });
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
    } finally {
      setStreaming("");
      setReasoning("");
      setSteps(0);
      setBusy(false);
      abortRef.current = null;
    }
  }

  /** Corre o plugin no servidor e devolve o resultado ao modelo para a resposta final. */
  async function executePlugin(request: PluginRequest) {
    const def = pluginById(request.id);
    if (!def) return;
    setPlugin({ ...request, state: "running" });
    try {
      const response = await fetch("/api/plugin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, args: request.args }),
      });
      const payload = (await response.json()) as { result?: string; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? t("O plugin falhou."));
      setPlugin({
        ...request,
        state: "done",
        detail: payload.result.slice(0, 220),
      });
      await run([
        ...pluginBase.current,
        {
          role: "user",
          content: `Resultado do plugin ${def.label}:\n${payload.result}\n\nResponde agora ao pedido com base neste resultado, sem pedir outro plugin.`,
        },
      ]);
    } catch (error) {
      setPlugin({ ...request, state: "error", detail: (error as Error).message });
    }
  }

  function allowPlugin() {
    if (!plugin) return;
    setPluginConnected(plugin.id, true);
    void executePlugin({ ...plugin, connected: true });
  }

  async function send(text: string, options?: { effort?: Effort; voice?: boolean }) {
    if (!text.trim() || !conversationId || busy) return;
    setDraft("");
    setPlugin(null);

    const targetConvId = conversationId;
    const clean = text.trim();

    // 1. Mensagem de utilizador criada e renderizada imediatamente de forma síncrona
    const userRowId = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const userRow: Row = {
      id: userRowId,
      role: "user",
      content: clean,
      created_at: new Date().toISOString(),
      feedback: null,
    };

    setMessages((current) => [...current, userRow]);
    if (typeof window !== "undefined" && targetConvId) {
      try {
        const rawStored = localStorage.getItem("griot_messages_" + targetConvId);
        const currentList: Row[] = rawStored ? JSON.parse(rawStored) : [];
        if (!currentList.some((m) => m.id === userRow.id)) {
          currentList.push(userRow);
          localStorage.setItem("griot_messages_" + targetConvId, JSON.stringify(currentList));
        }
      } catch {}
    }

    // 2. Persistência remota em background sem bloquear a IA nem a UI
    const persist = (async () => {
      try {
        const workspaceId = await getPrimaryWorkspaceId(userId);
        await (supabase as any)
          .from("griot_messages")
          .insert({
            id: userRowId,
            workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
            conversation_id: targetConvId,
            actor_kind: "human",
            content: clean,
            status: "succeeded",
          });
      } catch {
        // ignore
      }

      const needsTitle =
        !conversation?.title ||
        conversation.title === "Nova Conversa" ||
        conversation.title === "Novo Quick" ||
        conversation.title === "Conversa Principal";

      if (needsTitle) {
        const title = clean.slice(0, 48);
        try {
          await (supabase as any).from("griot_conversations").update({ title }).eq("id", targetConvId);
        } catch {}
        setConversation((current) => {
          const updated = current ? { ...current, title, updated_at: new Date().toISOString() } : current;
          if (updated) saveConversationLocally(updated);
          return updated;
        });
      } else if (conversation) {
        saveConversationLocally({ ...conversation, updated_at: new Date().toISOString() });
      }
    })();

    const base = messagesRef.current.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const answer = run([...base, { role: "user", content: clean }], options);
    await Promise.all([persist, answer]);
  }

  useEffect(() => {
    sendRef.current = send;
    runRef.current = run;
  });

  async function regenerate(assistantId: string) {
    if (busy) return;
    const index = messages.findIndex((m) => m.id === assistantId);
    if (index < 0) return;
    const base = messages
      .slice(0, index)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    await (supabase as any).from("griot_messages").delete().eq("id", assistantId).catch(() => null);
    setMessages((current) => current.filter((m) => m.id !== assistantId));
    await run(base);
  }

  async function editMessage(id: string) {
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    const target = messages[index];
    if (!target) return;
    const removed = messages.slice(index).map((m) => m.id);
    await (supabase as any).from("griot_messages").delete().in("id", removed).catch(() => null);
    setMessages((current) => current.slice(0, index));
    setDraft(target.content);
  }

  async function setFeedback(id: string, value: "like" | "dislike" | null) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, feedback: value } : m)));
    await (supabase as any)
      .from("griot_messages")
      .update({ metadata: { feedback: value } } as never)
      .eq("id", id)
      .catch(() => null);
  }

  async function startVoice() {
    const prefs = loadPrefs();
    const appLangName =
      (prefs["voiceLanguage"] as string) ||
      (prefs["appLanguage"] as string) ||
      labelFromLocale(locale);
    const langInfo = resolveSpeechLanguage(appLangName);

    dictationChunksRef.current = [];

    // Tenta abrir gravação direta como backup de alta precisão
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      dictationStreamRef.current = stream;
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) dictationChunksRef.current.push(e.data);
      };
      rec.start(150);
      dictationRecorderRef.current = rec;
    } catch {}

    const SpeechRecognition =
      (
        window as unknown as {
          SpeechRecognition?: new () => never;
          webkitSpeechRecognition?: new () => never;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition() as unknown as {
          lang: string;
          interimResults: boolean;
          continuous: boolean;
          start: () => void;
          stop: () => void;
          abort: () => void;
          onresult: (event: { results: Array<Array<{ transcript: string }>> }) => void;
          onerror: () => void;
          onend: () => void;
        };
        recognition.lang = langInfo.bcp47;
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (event) => {
          const parts: string[] = [];
          const results = event.results as unknown as ArrayLike<ArrayLike<{ transcript: string }>>;
          for (let index = 0; index < results.length; index += 1) {
            parts.push(results[index]?.[0]?.transcript ?? "");
          }
          setDraft(parts.join(" ").trim());
        };
        recognition.onerror = () => {
          // Erro no Web Speech nativo não invalida a gravação pelo MediaRecorder
        };
        recognition.onend = () => {
          setRecording(false);
          stopMeter();
        };
        recognitionRef.current = recognition;
        recognition.start();
      } catch {}
    }

    setRecording(true);
    void startMeter();
  }

  async function stopVoice(sendAfter: boolean) {
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    if (dictationRecorderRef.current && dictationRecorderRef.current.state !== "inactive") {
      dictationRecorderRef.current.stop();
    }
    dictationRecorderRef.current = null;

    if (dictationStreamRef.current) {
      dictationStreamRef.current.getTracks().forEach((t) => t.stop());
      dictationStreamRef.current = null;
    }

    setRecording(false);
    stopMeter();

    let finalText = draft.trim();

    // Se o reconhecimento nativo não apanhou nada mas gravámos o áudio, transcreve com STT de Elite!
    if (!finalText && dictationChunksRef.current.length > 0) {
      try {
        const blob = new Blob(dictationChunksRef.current, { type: "audio/webm" });
        const prefs = loadPrefs();
        const appLangName =
          (prefs["voiceLanguage"] as string) ||
          (prefs["appLanguage"] as string) ||
          labelFromLocale(locale);
        finalText = (await transcribeAudioElite(blob, { language: appLangName })).trim();
        if (finalText) setDraft(finalText);
      } catch {}
    }
    dictationChunksRef.current = [];

    if (sendAfter) {
      if (finalText) {
        window.setTimeout(() => void send(finalText), 60);
      } else {
        toast.error(t("Não consegui ouvir. Tenta outra vez."));
      }
    } else {
      setDraft("");
    }
  }

  /**
   * Conversa por voz real: microfone contínuo com deteção de fala, transcrição
   * no servidor e resposta falada com voz real, frase a frase, interrompível.
   */
  async function startVoiceChat() {
    if (sessionRef.current) return;
    setSheet(null);
    const prefs = loadPrefs();
    const chosenVoice = String(prefs["voice"] || "");
    const mappedVoice = TTS_VOICES[chosenVoice] || chosenVoice || "GRIOT Nativa";
    const appLang =
      (prefs["voiceLanguage"] as string) ||
      (prefs["appLanguage"] as string) ||
      labelFromLocale(locale);

    const session = new VoiceSession({
      bars: 22,
      voice: mappedVoice,
      speed: SPEECH_SPEEDS[String(prefs["voiceSpeed"])] ?? 1.0,
      languageName: appLang,
      allowInterrupt: prefs["allowInterrupt"] !== false,
      // Barge-in (voz ou orbe) aborta também o stream do modelo.
      onInterrupt: () => abortRef.current?.abort(),
      onState: (state) => {
        setVoiceState(state);
        if (state === "listening") {
          triggerHaptic("selection");
          setVoiceDraft("");
        } else if (state === "thinking") {
          triggerHaptic("medium");
        } else if (state === "speaking") {
          triggerHaptic("light");
        }
      },
      onLevels: (values) => setLevels(values),
      onPartial: (text) => setVoiceText(text),
      onPartialParts: (stable, tentative) => {
        setVoiceText(stable);
        setVoiceDraft(tentative);
      },
      onSpeakingSentence: (sentence) => {
        setVoiceText(sentence);
        setVoiceDraft("");
      },
      onError: (message) => toast.error(t(message)),
      onTranscript: async (said) => {
        lastAnswerRef.current = "";
        await sendRef.current?.(said, { effort: "low", voice: true });
        sessionRef.current?.finish();
      },
      // Reconciliação: a transcrição de alta precisão divergiu do arranque
      // otimista — corrige a mensagem e refaz a resposta.
      onCorrected: async (said) => {
        abortRef.current?.abort();
        lastAnswerRef.current = "";
        const rows = messagesRef.current;
        let index = -1;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.role === "user") {
            index = i;
            break;
          }
        }
        const base = (index >= 0 ? rows.slice(0, index) : rows).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        const target = index >= 0 ? rows[index] : undefined;
        if (target) {
          const removed = rows.slice(index + 1).map((m) => m.id);
          if (removed.length > 0) {
            await (supabase as any).from("griot_messages").delete().in("id", removed).catch(() => null);
          }
          await (supabase as any)
            .from("griot_messages")
            .update({ content: said } as never)
            .eq("id", target.id)
            .catch(() => null);
          setMessages((current) =>
            current
              .slice(0, index + 1)
              .map((m) => (m.id === target.id ? { ...m, content: said } : m)),
          );
        }
        await runRef.current?.([...base, { role: "user", content: said }], {
          effort: "low",
          voice: true,
        });
        sessionRef.current?.finish();
      },
    });

    sessionRef.current = session;
    setVoiceChat(true);
    try {
      await session.start();
    } catch {
      sessionRef.current = null;
      setVoiceChat(false);
      toast.error(t("Preciso de acesso ao microfone para conversar por voz."));
    }
  }

  function stopVoiceChat() {
    // Cancela também o stream do modelo: nada continua a falar nem a gastar tokens.
    abortRef.current?.abort();
    sessionRef.current?.stop();
    sessionRef.current = null;
    setVoiceText("");
    setVoiceDraft("");
    setVoiceState("listening");
    setVoiceChat(false);
  }

  /** Interromper: cala a resposta e volta a ouvir imediatamente. */
  function bargeIn() {
    triggerHaptic("selection");
    sessionRef.current?.interrupt();
  }

  useEffect(() => () => stopVoiceChat(), []);

  /** Enquanto o GRIOT pensa, o orbe respira com uma onda sintética suave.
   *  Ao ouvir e ao falar, os níveis reais chegam da VoiceSession. */
  useEffect(() => {
    if (!voiceChat || voiceState !== "thinking") return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      setLevels(
        Array.from({ length: 22 }, (_, index) => {
          const wave =
            Math.sin(elapsed * 5.2 + index * 0.55) * 0.5 +
            Math.sin(elapsed * 2.1 - index * 0.3) * 0.5;
          return Math.min(1, 0.14 + Math.abs(wave) * 0.18);
        }),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceChat, voiceState]);

  async function attach(file: File) {
    if (!conversationId) return;
    try {
      const isImg = file.type.startsWith("image/");
      const isVid = file.type.startsWith("video/");
      const isAud = file.type.startsWith("audio/");
      const kind = isImg ? "photo" : isVid ? "video" : isAud ? "audio" : "document";
      const saved = await saveCapture({
        kind,
        note: file.name,
        file,
        fileName: file.name,
        fileType: file.type,
        userId,
      });

      if (isImg) {
        const imgUrl = saved && saved.storage_path ? await captureUrl(saved.storage_path, saved) : null;
        if (imgUrl) {
          toast.success(t("Imagem anexada à conversa."));
          void send(`![${file.name}](${imgUrl})\n\nPor favor analisa esta imagem.`);
          return;
        }
      }

      if (
        file.type.startsWith("text/") ||
        file.type.includes("json") ||
        /\.(txt|json|md|ts|tsx|js|jsx|py|csv|html|css|yaml|yml|sql|sh)$/i.test(file.name)
      ) {
        try {
          const content = await file.text();
          toast.success(t("Ficheiro anexado à conversa."));
          void send(`[Ficheiro: ${file.name}]\n\`\`\`\n${content.slice(0, 12000)}\n\`\`\`\nPor favor analisa este ficheiro.`);
          return;
        } catch {}
      }

      toast.success(t("Adicionado à conversa."));
      void send(t(`Anexei o ficheiro "${file.name}".`));
    } catch {
      toast.error(t("Não foi possível enviar o ficheiro."));
    }
  }

  async function newConversation(next: "main" | "quick") {
    const defaultTitle = next === "quick" ? "Novo Quick" : "Nova Conversa";
    const localId = `conv_${next}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const createdConv: Conversation = {
      id: localId,
      scope: next,
      title: defaultTitle,
      model,
      pinned: false,
      archived: false,
      updated_at: new Date().toISOString(),
    };

    setScope(next);
    setConversation(createdConv);
    setMessages([]);
    saveConversationLocally(createdConv);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("griot_active_" + next + "_conv_id", localId);
      } catch {}
    }
    setDrawerKey((value) => value + 1);

    // Persiste no Supabase em segundo plano sem congelar a alternância
    void (async () => {
      try {
        const workspaceId = await getPrimaryWorkspaceId(userId);
        await (supabase as any)
          .from("griot_conversations")
          .insert({
            id: localId,
            workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
            owner_id: userId && userId !== "anonymous" ? userId : null,
            created_by: userId && userId !== "anonymous" ? userId : null,
            title: defaultTitle,
          });
      } catch {
        // ignore
      }
    })();
  }

  async function switchScope(targetScope: "main" | "quick") {
    if (targetScope === scope) return;

    // 1. Cancela imediatamente qualquer requisição ou streaming ativo
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setBusy(false);
    setStreaming("");
    setReasoning("");
    setSteps(0);
    setDraft("");
    setMessages([]);

    // 2. Guarda a conversa atual antes de alternar
    if (conversation) {
      saveConversationLocally({ ...conversation, scope });
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("griot_active_" + scope + "_conv_id", conversation.id);
        } catch {}
      }
    }

    setScope(targetScope);

    // 3. Procura a conversa ativa ou mais recente pertencente estritamente ao targetScope
    let targetConv: Conversation | null = null;
    if (typeof window !== "undefined") {
      try {
        const activeId = localStorage.getItem("griot_active_" + targetScope + "_conv_id");
        const raw = localStorage.getItem("griot_conversations_v1");
        if (raw) {
          const list: Conversation[] = JSON.parse(raw);
          if (activeId) {
            targetConv = list.find((c) => c.id === activeId && !c.archived && (c.scope || "main") === targetScope) || null;
          }
          if (!targetConv) {
            targetConv = list.find((c) => (c.scope || "main") === targetScope && !c.archived) || null;
          }
        }
      } catch {}
    }

    if (targetConv) {
      setConversation(targetConv);
      setModel(targetConv.model || DEFAULT_MODEL);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("griot_active_" + targetScope + "_conv_id", targetConv.id);
          const cached = localStorage.getItem("griot_messages_" + targetConv.id);
          if (cached) {
            const parsed = JSON.parse(cached);
            setMessages(Array.isArray(parsed) ? parsed : []);
          } else {
            setMessages([]);
          }
        } catch {
          setMessages([]);
        }
      }
    } else {
      await newConversation(targetScope);
    }
  }

  async function share() {
    const text = messages
      .map((m) => `${m.role === "user" ? t("Eu") : "GRIOT"}: ${m.content}`)
      .join("\n\n");
    const title = conversation?.title ?? t("Conversa GRIOT");
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast.success(t("Conversa copiada para a área de transferência."));
    }
  }

  async function togglePin() {
    if (!conversation) return;
    const pinned = !conversation.pinned;
    setConversation({ ...conversation, pinned });

    try {
      await (supabase as any)
        .from("griot_conversations")
        .update({ pinned })
        .eq("id", conversation.id);
    } catch {}

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("griot_conversations_v1");
        const list = raw ? JSON.parse(raw) : [];
        const index = list.findIndex((c: any) => c.id === conversation.id);
        if (index >= 0) {
          list[index] = { ...list[index], pinned };
        } else {
          list.push({ ...conversation, pinned });
        }
        localStorage.setItem("griot_conversations_v1", JSON.stringify(list));
        window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
      } catch {}
    }

    setDrawerKey((value) => value + 1);
    toast.success(pinned ? t("Conversa afixada.") : t("Conversa desafixada."));
  }

  async function archive() {
    if (!conversation) return;

    try {
      await (supabase as any)
        .from("griot_conversations")
        .update({ archived: true })
        .eq("id", conversation.id);
    } catch {}

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("griot_conversations_v1");
        const list = raw ? JSON.parse(raw) : [];
        const index = list.findIndex((c: any) => c.id === conversation.id);
        if (index >= 0) {
          list[index] = { ...list[index], archived: true };
        } else {
          list.push({ ...conversation, archived: true });
        }
        localStorage.setItem("griot_conversations_v1", JSON.stringify(list));
        window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
      } catch {}
    }

    toast.success(t("Conversa arquivada."));
    setConversation(null);
    setMessages([]);
    setDrawerKey((value) => value + 1);
    await newConversation(scope);
  }

  async function remove() {
    if (!conversation) return;

    try {
      await (supabase as any).from("griot_messages").delete().eq("conversation_id", conversation.id);
      await (supabase as any).from("griot_conversations").delete().eq("id", conversation.id);
    } catch {}

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("griot_conversations_v1");
        if (raw) {
          const list = JSON.parse(raw);
          const filtered = list.filter((c: any) => c.id !== conversation.id);
          localStorage.setItem("griot_conversations_v1", JSON.stringify(filtered));
        }
        localStorage.removeItem(`griot_messages_${conversation.id}`);
        window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
      } catch {}
    }

    toast.success(t("Conversa eliminada."));
    setConversation(null);
    setMessages([]);
    setDrawerKey((value) => value + 1);
    await newConversation(scope);
  }

  async function assignProject(projectId: string | null) {
    const nextProjectId = conversation?.project_id === projectId ? null : projectId;
    setActiveProject(nextProjectId || "");
    const proj = nextProjectId ? projects.find((p) => p.id === nextProjectId) : null;
    setActiveProjectState(proj || null);

    if (conversation) {
      try {
        await (supabase as any)
          .from("griot_conversations")
          .update({ project_id: nextProjectId })
          .eq("id", conversation.id);
      } catch {}

      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("griot_conversations_v1");
          const list = raw ? JSON.parse(raw) : [];
          const index = list.findIndex((c: any) => c.id === conversation.id);
          if (index >= 0) {
            list[index] = { ...list[index], project_id: nextProjectId };
          } else {
            list.push({ ...conversation, project_id: nextProjectId });
          }
          localStorage.setItem("griot_conversations_v1", JSON.stringify(list));
          window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
        } catch {}
      }

      setConversation((prev) => (prev ? { ...prev, project_id: nextProjectId } : null));
    }
    toast.success(nextProjectId ? t("Conversa ligada ao projeto.") : t("Conversa desvinculada do projeto."));
    setSheet(null);
  }

  const plusActions = [
    {
      id: "camera",
      label: t("Câmara"),
      hint: t("Tirar foto agora"),
      Icon: Camera,
      run: async () => {
        setSheet(null);
        try {
          const { Camera: CapCamera, CameraResultType, CameraSource } = await import("@capacitor/camera");
          const photo = await CapCamera.getPhoto({
            quality: 90,
            allowEditing: false,
            resultType: CameraResultType.Uri,
            source: CameraSource.Camera,
          });
          if (photo.webPath) {
            const res = await fetch(photo.webPath);
            const blob = await res.blob();
            const file = new File([blob], `camera_${Date.now()}.${photo.format || "jpg"}`, {
              type: blob.type || "image/jpeg",
            });
            void attach(file);
            return;
          }
        } catch {
          // Fallback para input de câmara web
        }
        cameraRef.current?.click();
      },
    },
    {
      id: "media",
      label: t("Imagem ou vídeo"),
      hint: t("Da galeria"),
      Icon: ImageIcon,
      run: () => {
        setSheet(null);
        mediaRef.current?.click();
      },
    },
    {
      id: "file",
      label: t("Ficheiros"),
      hint: t("Documentos e dados"),
      Icon: Paperclip,
      run: () => {
        setSheet(null);
        fileRef.current?.click();
      },
    },
    {
      id: "captures",
      label: t("Capture"),
      hint: t("Enviar conteúdo capturado"),
      Icon: Camera,
      run: () => setSheet("captures"),
    },
    {
      id: "plugins",
      label: t("Plugins"),
      hint: t("Agentes e integrações"),
      Icon: Puzzle,
      run: () => {
        setSheet(null);
        setPluginsViewOpen(true);
      },
    },
  ] as const;

  const conversationActions = [
    { id: "share", label: t("Partilhar"), Icon: Share2, run: share },
    {
      id: "pin",
      label: conversation?.pinned ? t("Desafixar") : t("Afixar"),
      Icon: Pin,
      run: togglePin,
    },
    {
      id: "project",
      label: t("Adicionar a projeto"),
      Icon: FolderPlus,
      run: async () => setSheet("projects"),
    },
    { id: "archive", label: t("Arquivar"), Icon: Archive, run: archive },
    { id: "delete", label: t("Eliminar"), Icon: Trash2, run: remove, danger: true },
  ] as const;

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        transform: drag ? `translate3d(${drag}px,0,0)` : undefined,
        opacity: drag ? Math.max(0.65, 1 - drag / 900) : undefined,
        transition: drag
          ? "none"
          : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "transform, opacity",
        touchAction: "pan-y",
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        touchRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          edge: touch.clientX < Math.max(window.innerWidth * 0.85, 300),
        };
        dragMeta.current = {
          last: touch.clientX,
          time: performance.now(),
          velocity: 0,
          active: false,
        };
      }}
      onTouchMove={(event) => {
        const start = touchRef.current;
        if (!start || !start.edge) return;
        const touch = event.touches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = Math.abs(touch.clientY - start.y);
        const meta = dragMeta.current;
        const now = performance.now();
        const elapsed = Math.max(1, now - meta.time);
        meta.velocity = (touch.clientX - meta.last) / elapsed;
        meta.last = touch.clientX;
        meta.time = now;
        if (!meta.active && dx > 8 && dx > dy * 0.7) meta.active = true;
        if (meta.active && dx > 0) {
          if (frame.current) cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setDrag(dx * 1.02));
        }
      }}
      onTouchEnd={() => {
        const start = touchRef.current;
        const meta = dragMeta.current;
        touchRef.current = null;
        if (frame.current) cancelAnimationFrame(frame.current);
        if (start?.edge && (drag > 50 || (drag > 18 && meta.velocity > 0.25))) {
          setDrag(window.innerWidth);
          window.setTimeout(() => void navigate({ to: "/home" }), 140);
          return;
        }
        setDrag(0);
      }}
    >
      {/* Barra superior fixa: zona ativa à esquerda (conversas) e à direita (ações). */}
      <div className="absolute inset-x-0 top-0 z-40 flex items-center pt-[calc(max(env(safe-area-inset-top,0px),24px)+4px)]">
        <button
          aria-label={t("Abrir conversas")}
          onClick={() => setDrawer(true)}
          className="h-11 flex-1 self-stretch"
        />
        <div className="flex shrink-0 rounded-full border border-hairline bg-surface/90 p-1 backdrop-blur-xl shadow-xs">
          {(["main", "quick"] as const).map((value) => (
            <button
              key={value}
              onClick={() => void switchScope(value)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 active:scale-95 ${
                scope === value ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {value === "main" ? t("Chat") : t("Quick")}
            </button>
          ))}
        </div>
        <button
          aria-label={t("Ações da conversa")}
          onClick={() => setSheet("actions")}
          className="h-11 flex-1 self-stretch"
        />
      </div>

      {/* Pré-visualização de Projeto / Jogo Criado */}
      {workspaceFiles.some((f) => f.path.endsWith(".html") || f.path === "index.html") && (
        <div className="absolute right-3.5 top-[calc(max(env(safe-area-inset-top,0px),24px)+6px)] z-45">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/20 px-3 py-1 text-[12px] font-medium text-primary shadow-sm backdrop-blur-xl hover:bg-primary/30 active:scale-95 transition-all"
          >
            <Play className="size-3 fill-primary" />
            <span>{t("Jogar")}</span>
          </button>
        </div>
      )}

      {/* Quick Mode Deliberation Bar posicionada no centro da tela ("no meio") apenas quando vazio */}
      {scope === "quick" && empty && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-30 pointer-events-none px-4">
          <div className="pointer-events-auto mx-auto max-w-lg rounded-3xl bg-card border border-white/[0.08] p-2.5 shadow-2xl">
            <DeliberationBar
              activeMission={deliberationMission}
              roleEngines={roleEngines}
              onSelectMission={(m) => setDeliberationMission(m)}
              onChangeRoleEngine={(r, e) => setRoleEngines((prev) => ({ ...prev, [r]: e }))}
            />
          </div>
        </div>
      )}

      {/* Feed da conversa */}
      <div className="no-scrollbar h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-lg flex-col space-y-5 px-5 pt-[calc(max(env(safe-area-inset-top,0px),24px)+52px)] pb-52">
          {/* Deliberation Bar no topo da lista quando há mensagens no modo Quick */}
          {scope === "quick" && !empty && (
            <div className="rounded-3xl bg-card border border-white/[0.08] p-2 shadow-md mb-2">
              <DeliberationBar
                activeMission={deliberationMission}
                roleEngines={roleEngines}
                onSelectMission={(m) => setDeliberationMission(m)}
                onChangeRoleEngine={(r, e) => setRoleEngines((prev) => ({ ...prev, [r]: e }))}
              />
            </div>
          )}

          {empty ? (
            <div className="pt-24 text-center">
              {scope !== "quick" && (
                <p className="text-[26px] font-medium tracking-tight text-muted-foreground">
                  {t("Como posso ajudar?")}
                </p>
              )}
              <button
                type="button"
                onClick={() => void navigate({ to: "/home" })}
                className="mt-3 inline-flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground/70 active:text-foreground transition-colors py-1 px-3 rounded-full hover:bg-white/[0.04]"
              >
                <ChevronLeft className="size-3.5" /> {t("arrasta da esquerda para sair")}
              </button>
            </div>
          ) : null}

          {messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              scope={scope}
              onEdit={(id) => void editMessage(id)}
              onFeedback={(id, value) => void setFeedback(id, value)}
              onRegenerate={(id) => void regenerate(id)}
              t={t}
              parseQuickSegments={parseQuickSegments}
              getPersonaConfig={getPersonaConfig}
              modelLabel={modelLabel}
            />
          ))}

          {busy ? <Thinking text={reasoning} active={!streaming} steps={steps} onStop={handleStop} /> : null}

          {streaming ? (
            scope === "quick" ? (
              <div className="space-y-3">
                {parseQuickSegments(stripPartialPlugin(stripPartialBlock(streaming))).map(
                  (segment, sIdx) => {
                    const cfg = getPersonaConfig(segment.roleRaw);
                    return (
                      <div key={sIdx} className="flex items-start gap-2.5 my-2 animate-fade-in">
                        <div
                          className={`relative grid size-9 shrink-0 place-items-center rounded-full border shadow-xs ${cfg.avatarBg}`}
                          title={cfg.name}
                        >
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0 max-w-[88%]">
                          <div className="flex items-center gap-2 mb-1 px-1">
                            <span className="text-[12px] font-semibold text-foreground tracking-tight">
                              {cfg.name}
                            </span>
                            <span className="rounded-md bg-secondary/80 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                              {cfg.badge}
                            </span>
                          </div>
                          <div className="rounded-3xl rounded-tl-sm border border-hairline/80 bg-surface/90 px-4 py-3 text-[15px] leading-relaxed text-foreground shadow-xs">
                            <MarkdownContent content={segment.content} />
                          </div>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            ) : (
              <div className="text-[15.5px] leading-relaxed">
                <MarkdownContent content={stripPartialPlugin(stripPartialBlock(streaming))} />
              </div>
            )
          ) : null}

          {plugin ? (
            <PluginBar request={plugin} onAllow={allowPlugin} onDeny={() => setPlugin(null)} />
          ) : null}

          {proposals.length > 0 && capsuleId ? (
            <div className="rise overflow-hidden rounded-[22px] border border-hairline bg-surface/70 backdrop-blur-xl">
              <p className="px-4 pt-3 pb-1 text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {t("Propostas para a Cápsula")}
              </p>
              {proposals.map((proposal) => (
                <div
                  key={proposal.key}
                  className="flex items-center gap-2 border-t border-hairline px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">
                    {"title" in proposal ? proposal.title : proposal.name}
                  </span>
                  <button
                    aria-label={t("Aprovar")}
                    onClick={() => void approve(proposal)}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground active:scale-90"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    aria-label={t("Rejeitar")}
                    onClick={() =>
                      setProposals((current) => current.filter((row) => row.key !== proposal.key))
                    }
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary active:scale-90"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attach(file);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attach(file);
          event.target.value = "";
        }}
      />
      <input
        ref={mediaRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attach(file);
          event.target.value = "";
        }}
      />

      {scope === "main" && !capsuleOpen ? (
        <button
          aria-label={t("Abrir Cápsula")}
          onClick={() => setCapsuleOpen(true)}
          className="absolute top-1/2 right-0 z-40 h-56 w-7 -translate-y-1/2 bg-transparent"
        />
      ) : null}

      {scope === "main" ? (
        <CapsulePanel
          open={capsuleOpen}
          onClose={() => setCapsuleOpen(false)}
          capsuleId={capsuleId}
          conversationId={conversationId}
          userId={userId}
          onCreated={setCapsuleId}
        />
      ) : null}

      {voiceChat ? (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-background/95 px-8 pt-[calc(env(safe-area-inset-top,0px)+28px)] pb-[calc(env(safe-area-inset-bottom,0px)+28px)] backdrop-blur-2xl animate-fade-in">
          <div className="flex w-full items-center justify-between">
            <span className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {t("Conversa por voz")}
            </span>
            <span className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {t("Modo rápido")}
            </span>
          </div>

          {/* Orbe: halo reativo, dois anéis a girar e onda radial de 48 barras. */}
          <button
            onClick={bargeIn}
            aria-label={t("Interromper")}
            className="relative grid size-[272px] shrink-0 place-items-center transition-transform duration-300 ease-out active:scale-[0.96]"
          >
            <span
              className="orb-drift absolute inset-0 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 32% 30%, var(--primary) 0%, transparent 62%), radial-gradient(circle at 70% 72%, var(--primary) 0%, transparent 58%)",
                opacity: 0.22 + (levels[8] ?? 0.12) * 0.5,
              }}
            />
            <span
              className="absolute rounded-full border border-primary/25"
              style={{
                inset: "6%",
                transform: `scale(${1 + (levels[10] ?? 0.12) * 0.16})`,
                transition: "transform 120ms ease-out",
              }}
            />
            <span
              className="orb-spin absolute rounded-full"
              style={{
                inset: "12%",
                background:
                  "conic-gradient(from 0deg, transparent 0deg, var(--primary) 90deg, transparent 190deg, var(--primary) 300deg, transparent 360deg)",
                opacity: voiceState === "thinking" ? 0.5 : 0.22,
                animationDuration: voiceState === "thinking" ? "1.6s" : "7s",
                maskImage: "radial-gradient(circle, transparent 62%, black 66%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 66%)",
              }}
            />
            <span
              className="orb-spin-reverse absolute rounded-full"
              style={{
                inset: "22%",
                background:
                  "conic-gradient(from 180deg, transparent 0deg, var(--foreground) 60deg, transparent 200deg)",
                opacity: 0.14,
                maskImage: "radial-gradient(circle, transparent 68%, black 72%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 68%, black 72%)",
              }}
            />
            <span
              className="orb-breathe absolute rounded-full bg-primary/20"
              style={{ inset: "30%" }}
            />
            <span
              className="absolute rounded-full bg-primary/30 backdrop-blur-xl"
              style={{
                inset: "34%",
                transform: `scale(${1 + (levels[4] ?? 0.12) * 0.3})`,
                transition: "transform 100ms ease-out",
              }}
            />

            <span className="absolute inset-0">
              {Array.from({ length: 48 }).map((_, index) => {
                const level = levels[index % levels.length] ?? 0.12;
                const length = 12 + level * 34;
                return (
                  <span
                    key={index}
                    className="absolute top-1/2 left-1/2 origin-bottom rounded-full bg-foreground/70"
                    style={{
                      width: "2px",
                      height: `${length}px`,
                      opacity: 0.25 + level * 0.6,
                      transform: `rotate(${index * 7.5}deg) translateY(-116px)`,
                      transition: "height 110ms ease-out, opacity 110ms ease-out",
                    }}
                  />
                );
              })}
            </span>

            <span className="relative flex h-14 items-center gap-[3px]">
              {levels.slice(0, 12).map((level, index) => (
                <span
                  key={index}
                  className="w-[3px] rounded-full bg-foreground"
                  style={{
                    height: `${Math.round(Math.max(10, level * 100))}%`,
                    opacity: 0.55 + level * 0.45,
                    transition: "height 100ms ease-out, opacity 100ms ease-out",
                  }}
                />
              ))}
            </span>
          </button>

          <div className="w-full text-center">
            <p
              key={voiceState}
              className={`animate-fade-in text-[12px] tracking-[0.18em] uppercase ${
                voiceState === "thinking" ? "shimmer-text" : "text-muted-foreground"
              }`}
            >
              {voiceState === "listening"
                ? t("A ouvir")
                : voiceState === "thinking"
                  ? t("A pensar")
                  : t("A responder")}
            </p>
            <p className="mt-3 min-h-[52px] line-clamp-3 text-[17px] leading-snug">
              {voiceText}
              {voiceDraft ? (
                <span className="text-muted-foreground/70">
                  {voiceText ? " " : ""}
                  {voiceDraft}
                </span>
              ) : null}
            </p>
            <p
              key={`hint-${voiceState}`}
              className="animate-fade-in mt-1 text-[11.5px] text-muted-foreground/70"
            >
              {voiceState === "speaking"
                ? t("toca no orbe para interromper")
                : t("fala normalmente")}
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={bargeIn}
                aria-label={t("Interromper")}
                disabled={voiceState !== "speaking"}
                className="grid size-12 place-items-center rounded-full bg-secondary transition-transform duration-200 active:scale-90 disabled:opacity-35"
              >
                <Square className="size-4" />
              </button>
              <button
                onClick={stopVoiceChat}
                aria-label={t("Terminar conversa por voz")}
                className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 active:scale-90"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConversationDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        activeId={conversationId}
        refreshKey={drawerKey}
        onSelect={(row) => {
          const targetScope = row.scope === "quick" ? "quick" : "main";
          setScope(targetScope);
          setConversation(row);
          setModel(row.model || DEFAULT_MODEL);
          saveConversationLocally(row);
          if (typeof window !== "undefined") {
            try {
              const cached = localStorage.getItem("griot_messages_" + row.id);
              if (cached) {
                setMessages(JSON.parse(cached));
              } else {
                setMessages([]);
              }
            } catch {
              setMessages([]);
            }
          }
        }}
        onCreate={(next) => void newConversation(next)}
      />

      {sheet ? (
        <button
          aria-label={t("Fechar")}
          onClick={() => setSheet(null)}
          className="fixed inset-0 z-40 bg-background/45 backdrop-blur-[2px]"
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="mx-auto w-full max-w-lg px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
          {sheet === "actions" ? (
            <div className="sheet-up mb-2 overflow-hidden rounded-[26px] border border-hairline bg-surface/95 backdrop-blur-2xl">
              {conversationActions.map(({ id, label, Icon, run, ...rest }) => (
                <button
                  key={id}
                  onClick={() => {
                    if (id !== "project") setSheet(null);
                    void run();
                  }}
                  className={`flex w-full items-center gap-3.5 border-b border-hairline px-4 py-3.5 text-left last:border-b-0 active:bg-secondary ${
                    "danger" in rest && rest.danger ? "text-destructive" : ""
                  }`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="text-[15px] font-medium">{t(label)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {sheet === "projects" ? (
            <div className="sheet-up mb-2 max-h-[55vh] overflow-y-auto rounded-[26px] border border-hairline bg-surface/95 backdrop-blur-2xl">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {t("Projetos")}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const title = prompt(t("Nome do novo projeto:"))?.trim();
                    if (!title) return;
                    const newProj = {
                      id: `proj_${Date.now()}`,
                      name: title,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    };
                    try {
                      await supabase.from("projects").insert({ name: title });
                    } catch {}
                    if (typeof window !== "undefined") {
                      const raw = localStorage.getItem("griot_local_projects");
                      const list = raw ? JSON.parse(raw) : [];
                      list.unshift(newProj);
                      localStorage.setItem("griot_local_projects", JSON.stringify(list));
                    }
                    setProjects((prev) => [newProj, ...prev]);
                    void assignProject(newProj.id);
                  }}
                  className="text-[12px] font-semibold text-primary active:opacity-70"
                >
                  + {t("Novo")}
                </button>
              </div>
              {projects.length === 0 ? (
                <div className="px-4 pb-4">
                  <p className="text-[14px] text-muted-foreground mb-3">
                    {t("Ainda não existem projetos.")}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      const title = prompt(t("Nome do projeto:"))?.trim() || "Meu Projeto";
                      const newProj = {
                        id: `proj_${Date.now()}`,
                        name: title,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      };
                      try {
                        await supabase.from("projects").insert({ name: title });
                      } catch {}
                      if (typeof window !== "undefined") {
                        const raw = localStorage.getItem("griot_local_projects");
                        const list = raw ? JSON.parse(raw) : [];
                        list.unshift(newProj);
                        localStorage.setItem("griot_local_projects", JSON.stringify(list));
                      }
                      setProjects([newProj]);
                      void assignProject(newProj.id);
                    }}
                    className="inline-flex items-center rounded-xl bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
                  >
                    + {t("Criar primeiro projeto")}
                  </button>
                </div>
              ) : (
                <>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => void assignProject(project.id)}
                      className="flex w-full items-center justify-between border-t border-hairline px-4 py-3.5 text-left active:bg-secondary"
                    >
                      <span className="text-[15px] font-medium">{project.name}</span>
                      {conversation?.project_id === project.id && (
                        <Check className="size-4 text-primary" />
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void assignProject(null)}
                    className="flex w-full items-center justify-between border-t border-hairline px-4 py-3 text-left active:bg-secondary text-muted-foreground"
                  >
                    <span className="text-[14px]">{t("Nenhum projeto (conversa livre)")}</span>
                    {!conversation?.project_id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </button>
                </>
              )}
            </div>
          ) : null}

          {sheet === "plus" ? (
            <div className="sheet-up mb-2 overflow-hidden rounded-[26px] border border-hairline bg-surface/95 backdrop-blur-2xl">
              {plusActions.map(({ id, label, hint, Icon, run }) => (
                <button
                  key={id}
                  onClick={() => {
                    setSheet(null);
                    run();
                  }}
                  className="flex w-full items-center gap-3.5 border-b border-hairline px-4 py-3.5 text-left last:border-b-0 active:bg-secondary"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{t(label)}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{t(hint)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {sheet === "captures" ? (
            <div className="sheet-up mb-2 max-h-[55vh] overflow-y-auto rounded-[26px] border border-hairline bg-surface/95 backdrop-blur-2xl">
              <p className="px-4 pt-3 pb-1 text-[9.5px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {t("Capture")}
              </p>
              {captures.length === 0 ? (
                <p className="px-4 py-4 text-[14px] text-muted-foreground">
                  {t("Ainda não capturaste nada.")}
                </p>
              ) : (
                captures.map((capture) => (
                  <button
                    key={capture.id}
                    onClick={() => {
                      setSheet(null);
                      void sendCapture(capture);
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b border-hairline px-4 py-3.5 text-left last:border-b-0 active:bg-secondary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">
                        {captureTitle(capture)}
                      </span>
                      <span className="block text-[12px] text-muted-foreground">
                        {exactDateTime(capture.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {t(capture.kind)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {sheet === "model" ? (
            <div className="sheet-up mx-auto mb-2 w-full max-w-[300px] overflow-hidden rounded-[20px] border border-hairline bg-surface/95 backdrop-blur-2xl">
              <p className="px-3.5 pt-2.5 pb-1 text-[9.5px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {t("APIs de IA")}
              </p>
              <div className="max-h-[50vh] overflow-y-auto no-scrollbar">
                {availableModels.length === 0 ? (
                  <div className="px-4 py-5 text-center">
                    <p className="text-[13px] font-medium text-foreground">
                      {t("Nenhuma API adicionada")}
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {t("Adiciona a tua chave do Google Gemini, OpenAI ou Claude para começar.")}
                    </p>
                    <div className="mt-3.5 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSheet(null);
                          setAddApiModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground shadow-sm active:scale-95 transition-transform"
                      >
                        <Plus className="size-3.5" />
                        <span>{t("Adicionar API")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSheet(null);
                          void navigate({ to: "/home" });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-secondary/50 px-3 py-1.5 text-[12px] font-medium text-foreground active:scale-95 transition-transform"
                      >
                        <span>{t("Ver na Home")}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  availableModels.map((option) => (
                    <button
                      key={option.id}
                      onClick={async () => {
                        setModel(option.id);
                        setSheet(null);
                        if (conversationId && !conversationId.startsWith("local-conv-")) {
                          try {
                            localStorage.setItem(`griot_conv_model_${conversationId}`, option.id);
                          } catch {}
                        }
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left active:bg-secondary transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {(() => {
                          const Logo = isModelOS(option.id) ? GriotAiLogo : getAiLogo(option.id.split(":")[0]);
                          return (
                            <div className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline/60 bg-surface">
                              <Logo className="size-3.5 text-foreground" />
                            </div>
                          );
                        })()}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium leading-tight">
                            {option.label}
                          </span>
                          <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
                            {option.hint}
                          </span>
                        </span>
                      </div>
                      {model === option.id ? (
                        <Check className="size-[14px] shrink-0 text-foreground" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
              <div className="mt-1.5 flex gap-1 border-t border-hairline p-2">
                {EFFORTS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setEffort(option.id)}
                    className={`flex-1 rounded-xl px-1.5 py-1.5 text-[11px] font-medium transition-colors duration-200 ${
                      effort === option.id ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {t(option.label)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Card de Permissão do Google Cloud Shell - Posicionado imediatamente acima da barra de texto */}
          {cloudShellRequired && (
            <div className="mb-2.5 overflow-hidden rounded-[24px] bg-card border border-white/[0.08] p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200">
              {/* Cabeçalho com Ícone e Nome do Serviço */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Terminal className="size-3.5" />
                  </div>
                  <span className="text-[13px] font-semibold text-foreground">
                    Google Cloud Shell
                  </span>
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Sandbox
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCloudShellRequired(false)}
                  className="rounded-full p-1 text-muted-foreground hover:text-foreground active:scale-90"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Título e Explicação */}
              <div className="mt-2.5">
                <h4 className="text-[15px] font-semibold tracking-tight text-foreground">
                  {t("Permitir execução no Cloud Shell?")}
                </h4>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {t("O GRIOT precisa da sua aprovação para executar comandos pesados em ambiente sandbox na nuvem.")}
                </p>
                {cloudShellCmd ? (
                  <div className="mt-2.5 rounded-xl bg-secondary px-3 py-2 text-[11.5px] font-mono text-foreground/90 break-all select-all">
                    {cloudShellCmd}
                  </div>
                ) : null}
              </div>

              {/* Botões de Ação Perfeitamente Alinhados (Empilhados como no modelo de referência) */}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={connectingGoogle}
                  onClick={() => void handleConnectGoogleCloud()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground shadow-sm transition-transform active:scale-[0.98]"
                >
                  <CloudLightning className="size-4" />
                  <span>{connectingGoogle ? t("A ligar à Google...") : t("Ligar com a Google")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCloudShellRequired(false)}
                  className="flex h-10 w-full items-center justify-center rounded-2xl bg-secondary px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-transform active:scale-[0.98]"
                >
                  <span>{t("Recusar")}</span>
                </button>
              </div>
            </div>
          )}

          <div className="rounded-[28px] border border-hairline bg-surface/90 px-3 pt-3 pb-2.5 shadow-[0_22px_50px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
            {recording ? (
              <div className="flex items-center gap-3 py-1">
                <button
                  onClick={() => stopVoice(false)}
                  aria-label={t("Cancelar gravação")}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary active:scale-90"
                >
                  <X className="size-[18px]" />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="relative grid size-9 shrink-0 place-items-center">
                    <span className="pulse-ring absolute inset-0 rounded-full bg-destructive/30" />
                    <span className="size-2.5 rounded-full bg-destructive" />
                  </span>
                  <span className="flex h-8 flex-1 items-center gap-[3px]">
                    {levels.map((level, index) => (
                      <span
                        key={index}
                        className="w-[3px] rounded-full bg-foreground/70"
                        style={{
                          height: `${Math.round(level * 100)}%`,
                          opacity: 0.45 + level * 0.55,
                          transition: "height 90ms ease-out, opacity 90ms ease-out",
                        }}
                      />
                    ))}
                  </span>

                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </span>
                </div>
                <button
                  onClick={() => stopVoice(true)}
                  aria-label={t("Concluir gravação")}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground active:scale-90"
                >
                  <Check className="size-[18px]" />
                </button>
              </div>
            ) : (
              <>
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(draft);
                    }
                  }}
                  placeholder={t("Escrever")}
                  className="max-h-36 w-full resize-none bg-transparent px-1.5 pb-2 text-[15.5px] outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSheet(sheet === "plus" ? null : "plus")}
                    aria-label={t("Adicionar")}
                    className={`grid size-9 shrink-0 place-items-center rounded-full bg-secondary transition-transform duration-300 active:scale-90 ${
                      sheet === "plus" ? "rotate-45" : ""
                    }`}
                  >
                    <Plus className="size-[18px]" />
                  </button>
                  <button
                    onClick={() => {
                      if (availableModels.length === 0) {
                        setAddApiModalOpen(true);
                      } else {
                        setSheet(sheet === "model" ? null : "model");
                      }
                    }}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all ${
                      availableModels.length === 0
                        ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
                        : "bg-secondary text-foreground hover:bg-secondary/80 border border-hairline/60"
                    }`}
                  >
                    {availableModels.length > 0 && (() => {
                      const Logo = isModelOS(model) ? GriotAiLogo : getAiLogo(model.split(":")[0]);
                      return <Logo className="size-3.5 shrink-0 text-foreground" />;
                    })()}
                    <span className="max-w-[130px] truncate">
                      {availableModels.length === 0 ? t("+ Adicionar API") : modelLabel(model)}
                    </span>
                    <ChevronDown
                      className={`size-4 ${
                        availableModels.length === 0
                          ? "text-primary/70"
                          : "text-muted-foreground"
                      }`}
                    />
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={() => (voiceChat ? stopVoiceChat() : void startVoiceChat())}
                    aria-label={voiceChat ? t("Terminar conversa por voz") : t("Conversa por voz")}
                    aria-pressed={voiceChat}
                    className={`grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 active:scale-90 ${
                      voiceChat ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    <AudioLines className="size-[18px]" />
                  </button>

                  <button
                    onClick={() =>
                      busy
                        ? handleStop()
                        : draft.trim().length > 0
                          ? void send(draft)
                          : startVoice()
                    }
                    aria-label={
                      busy ? t("Parar") : draft.trim().length > 0 ? t("Enviar") : t("Gravar")
                    }
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 active:scale-90"
                  >
                    {busy ? (
                      <Square className="size-3.5 fill-current" />
                    ) : draft.trim().length > 0 ? (
                      <ArrowUp className="size-[18px]" />
                    ) : (
                      <Mic className="size-[18px]" />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Modal para Adicionar API de IA diretamente dentro do Chat */}
      <AddApiModal
        open={addApiModalOpen}
        onClose={() => setAddApiModalOpen(false)}
        onSuccess={(savedApi) => {
          setApisRevision((r) => r + 1);
          setModel(savedApi.id || savedApi.providerId);
          setSheet(null);
        }}
      />

      {/* Modal de Pré-visualização do Jogo / Aplicação Web do Workspace */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] bg-surface/90 backdrop-blur-xl">
            <span className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
              <Play className="size-4 fill-primary text-primary" />
              {t("Pré-visualização do Projeto / Jogo")}
            </span>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-xl border border-hairline bg-secondary/60 p-1.5 text-muted-foreground hover:text-foreground active:scale-90"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 w-full bg-white">
            <iframe
              title="Project Preview"
              sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
              srcDoc={generatePreviewSrcDoc(workspaceFiles)}
              className="h-full w-full border-none"
            />
          </div>
        </div>
      )}

      {/* Modal do Gestor de Plugins Reais */}
      {pluginsViewOpen && (
        <div className="fixed inset-0 z-50 bg-background animate-in fade-in duration-200">
          <PluginsView onBack={() => setPluginsViewOpen(false)} />
        </div>
      )}
    </div>
  );
}
