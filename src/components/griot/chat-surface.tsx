import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_MODEL, getAvailableModels, modelLabel, isModelOS } from "@/lib/griot";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";
import { toast } from "sonner";
import { Thinking } from "@/components/griot/thinking";
import { UserActions, AssistantActions } from "@/components/griot/message-actions";
import { ConversationDrawer, type Conversation } from "@/components/griot/chat-drawers";
import { labelFromLocale, useI18n, useT } from "@/lib/i18n";
import { VoiceSession } from "@/lib/voice-session";
import { loadPrefs } from "@/lib/settings";
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
import { DeliberationBar } from "@/components/griot/deliberation-bar";
import {
  DELIBERATION_MISSIONS,
  DELIBERATION_ROLES,
  buildRoleSystemInstruction,
  type DeliberationMissionId,
  type DeliberationRoleId,
  type GriotVerdict,
} from "@/lib/runtime/deliberation-room";

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
} from "lucide-react";

import {
  captureAsText,
  captureTitle,
  exactDateTime,
  listQuickCaptures,
  type CaptureRow,
} from "@/lib/capture-share";

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
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>("medium");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [drawer, setDrawer] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [deliberationMission, setDeliberationMission] = useState<DeliberationMissionId>("ideate");
  const [roleEngines, setRoleEngines] = useState<Record<DeliberationRoleId, string>>({
    strategist: "gemini:gemini-3.6-flash",
    analyst: "app:claude",
    innovator: "app:chatgpt",
    critic: "gemini:gemini-3.6-flash",
  });
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 22 }, () => 0.12));
  const [seconds, setSeconds] = useState(0);
  const [voiceChat, setVoiceChat] = useState(false);
  const [voiceState, setVoiceState] = useState<"listening" | "thinking" | "speaking">("listening");
  const [voiceText, setVoiceText] = useState("");
  const [voiceDraft, setVoiceDraft] = useState("");

  const availableModels = useMemo(() => getAvailableModels(prefs), [prefs]);

  useEffect(() => {
    const handlePrefsChange = () => setPrefs(loadPrefs());
    window.addEventListener("storage", handlePrefsChange);
    window.addEventListener("griot:prefs-changed", handlePrefsChange);
    window.addEventListener("focus", handlePrefsChange);
    return () => {
      window.removeEventListener("storage", handlePrefsChange);
      window.removeEventListener("griot:prefs-changed", handlePrefsChange);
      window.removeEventListener("focus", handlePrefsChange);
    };
  }, []);

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
  const lastAnswerRef = useRef("");
  const sessionRef = useRef<VoiceSession | null>(null);
  // Callbacks da sessão de voz vivem para lá de um render: estes refs garantem
  // que cada turno usa o histórico e as funções mais recentes.
  const messagesRef = useRef<Row[]>([]);
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
      try {
        const { data: existing, error: selectError } = await (supabase as any)
          .from("griot_conversations")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let row: Conversation | null = null;
        if (existing) {
          row = {
            id: existing.id,
            scope,
            title: existing.title || "Conversa Principal",
            model: DEFAULT_MODEL,
            pinned: false,
            archived: false,
            updated_at: existing.updated_at,
          };
        }

        if (!row && !selectError) {
          const workspaceId = await getPrimaryWorkspaceId(userId);
          const { data: created } = await (supabase as any)
            .from("griot_conversations")
            .insert({
              workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
              title: "Conversa Principal",
              owner_id: userId && userId !== "anonymous" ? userId : null,
              created_by: userId && userId !== "anonymous" ? userId : null,
            })
            .select("id, title, updated_at")
            .single();

          if (created) {
            row = {
              id: created.id,
              scope,
              title: created.title || "Conversa Principal",
              model: DEFAULT_MODEL,
              pinned: false,
              archived: false,
              updated_at: created.updated_at,
            };
          }
        }

        // Fallback local caso o Supabase não esteja disponível ou ocorra erro
        if (!row) {
          row = {
            id: "local-conv-" + scope,
            scope,
            title: "Conversa Principal",
            model: DEFAULT_MODEL,
            pinned: false,
            archived: false,
            updated_at: new Date().toISOString(),
          };
        }

        if (cancelled || !row) return;
        setConversation(row);
        setModel(row.model || DEFAULT_MODEL);
      } catch (err) {
        console.warn("Fallback de conversa local acionado:", err);
        if (!cancelled) {
          const localFallback: Conversation = {
            id: "local-conv-" + scope,
            scope,
            title: "Conversa Principal",
            model: DEFAULT_MODEL,
            pinned: false,
            archived: false,
            updated_at: new Date().toISOString(),
          };
          setConversation(localFallback);
          setModel(DEFAULT_MODEL);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scope, userId]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (supabase as any)
      .from("griot_messages")
      .select("id, actor_kind, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .then(({ data }: any) => {
        if (!cancelled && data && data.length > 0) {
          setMessages(
            data.map((m: any) => ({
              id: m.id,
              role: m.actor_kind === "human" ? "user" : m.actor_kind === "model" ? "assistant" : "system",
              content: m.content,
              created_at: m.created_at,
              feedback: null,
            })),
          );
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
    if (sheet !== "projects") return;
    async function fetchProjects() {
      try {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("archived", false)
          .order("updated_at", { ascending: false });

        let list: { id: string; name: string }[] = data ? [...data] : [];
        if (typeof window !== "undefined") {
          const raw = localStorage.getItem("griot_local_projects");
          if (raw) {
            try {
              const localList = JSON.parse(raw);
              for (const lp of localList) {
                if (!list.some((p) => p.id === lp.id)) {
                  list.push({ id: lp.id, name: lp.name });
                }
              }
            } catch {}
          }
        }
        setProjects(list);
      } catch {
        if (typeof window !== "undefined") {
          const raw = localStorage.getItem("griot_local_projects");
          if (raw) {
            try {
              setProjects(JSON.parse(raw));
            } catch {}
          }
        }
      }
    }
    void fetchProjects();
  }, [sheet]);

  // Capture no “+”: primeiro as marcadas como rápidas, depois as mais recentes.
  useEffect(() => {
    if (sheet !== "captures") return;
    void supabase
      .from("captures")
      .select(
        "id, kind, note, storage_path, mime_type, latitude, longitude, project_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(24)
      .then(({ data }) => {
        const rows = (data ?? []) as CaptureRow[];
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
    const { data: inserted } = await supabase
      .from("messages")
      .insert({ user_id: userId, conversation_id: conversationId, role: "user", content })
      .select("id, role, content, created_at, feedback")
      .single();
    if (inserted) {
      const row = inserted as unknown as Row;
      setMessages((current) =>
        current.some((m) => m.id === row.id) ? current : [...current, row],
      );
    }
    toast.success(t("Captura adicionada à conversa."));
  }

  const empty = messages.length === 0 && !streaming && !reasoning;

  const history = useMemo(
    () => messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    [messages],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  async function run(
    base: { role: "user" | "assistant"; content: string }[],
    options?: { effort?: Effort; voice?: boolean },
  ) {
    if (!conversationId) return;
    const activeEffort = options?.effort ?? effort;
    const voiceMode = options?.voice === true;
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

    try {
      const lastMsg = base[base.length - 1]?.content || "";
      const mLabel = modelLabel(model);

      let streamedAny = false;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
              model,
              effort: activeEffort,
              messages: base,
              capsule: context,
              voice: voiceMode,
              conversationId,
              conversationTitle: conversation?.title,
            }),
            signal: controller.signal,
          });

          if (response.ok && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const event = JSON.parse(line) as { t: string; d: string };
                  if (event.t === "text") {
                    answer += event.d;
                    setStreaming(answer);
                    streamedAny = true;
                    if (voiceMode) sessionRef.current?.feed(event.d);
                  } else if (event.t === "reason") {
                    setReasoning((current) => current + event.d);
                  } else if (event.t === "step") {
                    setSteps((current) => current + 1);
                  }
                } catch {
                  // fragmento incompleto
                }
              }
            }
          }
        } catch (networkErr) {
          console.warn("fetch /api/chat falhou no ambiente:", networkErr);
        }

        if (!streamedAny || !answer.trim()) {
          toast.error(
            `Sem ligação ao modelo ${mLabel}. Adiciona a tua chave de API em Home ou Definições → Chave de IA para conversar.`,
          );
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

      void observerEngine.processIncomingAIMessage(
        {
          provider: appKey as any,
          model,
          sessionTitle:
            boundThreadTitle ||
            conversation?.title ||
            (isModelOS(model) ? "ModelOS Cluster" : "Sessão Ativa"),
          appId: appKey,
        },
        answer,
        conversationId || "main",
      );

      lastAnswerRef.current = answer;

      if (answer.trim()) {
        let row: Row | null = null;
        try {
          const workspaceId = await getPrimaryWorkspaceId(userId);
          const { data: saved } = await (supabase as any)
            .from("griot_messages")
            .insert({
              workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
              conversation_id: conversationId,
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
        setMessages((current) =>
          current.some((m) => m.id === row!.id) ? current : [...current, row!],
        );
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
    } finally {
      setStreaming("");
      setReasoning("");
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

    const clean = text.trim();
    // Em voz a resposta arranca primeiro; a gravação da mensagem acontece em paralelo.
    const persist = (async () => {
      let row: Row | null = null;
      try {
        const workspaceId = await getPrimaryWorkspaceId(userId);
        const { data: inserted } = await (supabase as any)
          .from("griot_messages")
          .insert({
            workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
            conversation_id: conversationId,
            actor_kind: "human",
            content: clean,
            status: "succeeded",
          })
          .select("id, actor_kind, content, created_at")
          .single();
        if (inserted) {
          row = {
            id: inserted.id,
            role: "user",
            content: inserted.content,
            created_at: inserted.created_at,
            feedback: null,
          };
        }
      } catch {
        // ignore
      }
      if (!row) {
        row = {
          id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          content: clean,
          created_at: new Date().toISOString(),
          feedback: null,
        };
      }
      setMessages((current) =>
        current.some((m) => m.id === row!.id) ? current : [...current, row!],
      );
      if (!conversation?.title) {
        const title = clean.slice(0, 48);
        try {
          await (supabase as any).from("griot_conversations").update({ title }).eq("id", conversationId);
        } catch {
          // ignore
        }
        setConversation((current) => (current ? { ...current, title } : current));
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

  function startVoice() {
    const SpeechRecognition =
      (
        window as unknown as {
          SpeechRecognition?: new () => never;
          webkitSpeechRecognition?: new () => never;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error(t("Este dispositivo não permite ditado por voz no browser."));
      return;
    }
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
    recognition.lang = "pt-PT";
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
      setRecording(false);
      stopMeter();
      toast.error(t("Não consegui ouvir. Tenta outra vez."));
    };
    recognition.onend = () => {
      setRecording(false);
      stopMeter();
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    void startMeter();
  }

  function stopVoice(sendAfter: boolean) {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
    stopMeter();
    if (sendAfter) {
      const text = draft;
      window.setTimeout(() => void send(text), 60);
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
    const session = new VoiceSession({
      bars: 22,
      voice: TTS_VOICES[String(prefs["voice"])] ?? "alloy",
      speed: SPEECH_SPEEDS[String(prefs["voiceSpeed"])] ?? 1.0,
      languageName: labelFromLocale(locale),
      allowInterrupt: prefs["allowInterrupt"] !== false,
      // Barge-in (voz ou orbe) aborta também o stream do modelo.
      onInterrupt: () => abortRef.current?.abort(),
      onState: (state) => setVoiceState(state),
      onLevels: (values) => setLevels(values),
      onPartial: (text) => setVoiceText(text),
      onPartialParts: (stable, tentative) => {
        setVoiceText(stable);
        setVoiceDraft(tentative);
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
    const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("captures").upload(path, file);
    if (error) {
      toast.error(t("Não foi possível enviar o ficheiro."));
      return;
    }
    await supabase.from("captures").insert({
      user_id: userId,
      kind: file.type.startsWith("image/")
        ? "photo"
        : file.type.startsWith("video/")
          ? "video"
          : "document",
      note: file.name,
      mime_type: file.type || null,
      storage_path: path,
    });
    toast.success(t("Adicionado à conversa."));
    void send(t(`Anexei o ficheiro "${file.name}".`));
  }

  async function newConversation(next: "main" | "quick") {
    let createdConv: Conversation | null = null;
    try {
      const workspaceId = await getPrimaryWorkspaceId(userId);
      const { data: created } = await (supabase as any)
        .from("griot_conversations")
        .insert({
          workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
          owner_id: userId && userId !== "anonymous" ? userId : null,
          created_by: userId && userId !== "anonymous" ? userId : null,
          title: "Nova Conversa",
        })
        .select("id, title, updated_at")
        .single();
      if (created) {
        createdConv = {
          id: created.id,
          scope: next,
          title: created.title || "Nova Conversa",
          model,
          pinned: false,
          archived: false,
          updated_at: created.updated_at,
        };
      }
    } catch {
      // ignore
    }

    if (!createdConv) {
      createdConv = {
        id: "local-conv-" + Date.now(),
        scope: next,
        title: "Nova Conversa",
        model,
        pinned: false,
        archived: false,
        updated_at: new Date().toISOString(),
      };
    }

    setScope(next);
    setConversation(createdConv);
    setMessages([]);
    setDrawerKey((value) => value + 1);
  }

  async function share() {
    const text = messages
      .map((m) => `${m.role === "user" ? t("Eu") : "GRIOT"}: ${m.content}`)
      .join("\n\n");
    const title = conversation?.title ?? t("Conversa GRIOT");
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch {
        return;
      }
    }
    await navigator.clipboard.writeText(text);
    toast.success(t("Conversa copiada."));
  }

  async function togglePin() {
    if (!conversation) return;
    const pinned = !conversation.pinned;
    setConversation({ ...conversation, pinned });
    setDrawerKey((value) => value + 1);
    toast.success(pinned ? t("Conversa afixada.") : t("Conversa desafixada."));
  }

  async function archive() {
    if (!conversation) return;
    toast.success(t("Conversa arquivada."));
    setConversation(null);
    setMessages([]);
    setDrawerKey((value) => value + 1);
    await newConversation(scope);
  }

  async function remove() {
    if (!conversation) return;
    await (supabase as any).from("griot_messages").delete().eq("conversation_id", conversation.id).catch(() => null);
    await (supabase as any).from("griot_conversations").delete().eq("id", conversation.id).catch(() => null);
    toast.success(t("Conversa eliminada."));
    setConversation(null);
    setMessages([]);
    setDrawerKey((value) => value + 1);
    await newConversation(scope);
  }

  async function assignProject(projectId: string) {
    if (!conversation) return;
    try {
      await (supabase as any)
        .from("griot_conversations")
        .update({ project_id: projectId })
        .eq("id", conversation.id);
    } catch {}

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("griot_conversations_v1");
        if (raw) {
          const list = JSON.parse(raw);
          const updated = list.map((c: any) =>
            c.id === conversation.id ? { ...c, project_id: projectId } : c,
          );
          localStorage.setItem("griot_conversations_v1", JSON.stringify(updated));
        }
      } catch {}
    }

    setConversation((prev) => (prev ? { ...prev, project_id: projectId } : null));
    toast.success(t("Conversa ligada ao projeto."));
    setSheet(null);
  }

  const plusActions = [
    {
      id: "camera",
      label: t("Câmara"),
      hint: t("Tirar foto agora"),
      Icon: Camera,
      run: () => cameraRef.current?.click(),
    },
    {
      id: "media",
      label: t("Imagem ou vídeo"),
      hint: t("Da galeria"),
      Icon: ImageIcon,
      run: () => mediaRef.current?.click(),
    },
    {
      id: "file",
      label: t("Ficheiros"),
      hint: t("Documentos e dados"),
      Icon: Paperclip,
      run: () => fileRef.current?.click(),
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
      run: () =>
        toast(
          t("Os plugins pedem permissão no chat quando o GRIOT precisa deles.") +
            " " +
            PLUGINS.map((item) => item.label).join(" · "),
        ),
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
      <div className="absolute inset-x-0 top-0 z-40 flex items-center pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        <button
          aria-label={t("Abrir conversas")}
          onClick={() => setDrawer(true)}
          className="h-11 flex-1 self-stretch"
        />
        <div className="flex shrink-0 rounded-full border border-hairline bg-surface/90 p-1 backdrop-blur-xl">
          {(["main", "quick"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
                scope === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
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

      {scope === "quick" && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <div className="pointer-events-auto">
            <DeliberationBar
              activeMission={deliberationMission}
              roleEngines={roleEngines}
              onSelectMission={(m) => setDeliberationMission(m)}
              onChangeRoleEngine={(r, e) => setRoleEngines((prev) => ({ ...prev, [r]: e }))}
            />
          </div>
        </div>
      )}

      <div className="no-scrollbar h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-lg flex-col space-y-5 px-5 pt-[calc(env(safe-area-inset-top,0px)+70px)] pb-44">
          {empty ? (
            <div className="pt-24 text-center">
              <p className="text-[26px] font-medium tracking-tight text-muted-foreground">
                {t("Como posso ajudar?")}
              </p>
              <button
                type="button"
                onClick={() => void navigate({ to: "/home" })}
                className="mt-3 inline-flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground/70 active:text-foreground transition-colors py-1 px-3 rounded-full hover:bg-white/[0.04]"
              >
                <ChevronLeft className="size-3.5" /> {t("arrasta da esquerda para sair")}
              </button>
            </div>
          ) : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex flex-col items-end">
                <div className="max-w-[85%] rounded-3xl bg-primary px-4 py-2.5 text-[15.5px] leading-relaxed text-primary-foreground">
                  {message.content}
                </div>
                <UserActions
                  content={message.content}
                  onEdit={() => void editMessage(message.id)}
                />
              </div>
            ) : (
              <div key={message.id}>
                {(message as any).model?.startsWith("app:") ? (
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span>{modelLabel((message as any).model)}</span>
                    <span className="text-muted-foreground/60 text-[10.5px]">
                      · {t("Chat Fixo")}
                    </span>
                  </div>
                ) : null}
                <div className="text-[15.5px] leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>
                <AssistantActions
                  content={message.content}
                  feedback={message.feedback ?? null}
                  onFeedback={(value) => void setFeedback(message.id, value)}
                  onRegenerate={() => void regenerate(message.id)}
                />
              </div>
            ),
          )}

          {busy ? <Thinking text={reasoning} active={!streaming} steps={steps} /> : null}

          {streaming ? (
            <div className="text-[15.5px] leading-relaxed whitespace-pre-wrap">
              {stripPartialPlugin(stripPartialBlock(streaming))}
            </div>
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
          setScope(row.scope === "quick" ? "quick" : "main");
          setConversation(row);
          setModel(row.model || DEFAULT_MODEL);
          setMessages([]);
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
                projects.map((project) => (
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
                ))
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
                {t("Modelo")}
              </p>
              <div className="max-h-[50vh] overflow-y-auto no-scrollbar">
                {availableModels.map((option) => (
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
                    className={`flex w-full items-center justify-between gap-2 px-3.5 py-1.5 text-left active:bg-secondary transition-colors ${
                      isModelOS(option.id) ? "text-[#c084fc] hover:bg-[#a855f7]/10" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[13px] font-medium leading-tight ${
                          isModelOS(option.id) ? "text-[#c084fc] font-semibold" : ""
                        }`}
                      >
                        {option.label}
                      </span>
                      <span
                        className={`block truncate text-[10.5px] leading-tight ${
                          isModelOS(option.id) ? "text-[#c084fc]/70" : "text-muted-foreground"
                        }`}
                      >
                        {option.hint}
                      </span>
                    </span>
                    {model === option.id ? (
                      <Check
                        className={`size-[14px] shrink-0 ${
                          isModelOS(option.id) ? "text-[#c084fc]" : ""
                        }`}
                      />
                    ) : null}
                  </button>
                ))}
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
                    onClick={() => setSheet(sheet === "model" ? null : "model")}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all ${
                      isModelOS(model)
                        ? "bg-[#a855f7]/15 hover:bg-[#a855f7]/25 text-[#c084fc] border border-[#a855f7]/30"
                        : "bg-secondary text-foreground hover:bg-secondary/80"
                    }`}
                  >
                    <span className="max-w-[130px] truncate">{modelLabel(model)}</span>
                    <ChevronDown
                      className={`size-4 ${
                        isModelOS(model) ? "text-[#c084fc]/70" : "text-muted-foreground"
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
                        ? abortRef.current?.abort()
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
                      <Square className="size-3.5" />
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
    </div>
  );
}
