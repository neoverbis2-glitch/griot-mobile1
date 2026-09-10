/**
 * GRIOT Chat Execution Manager
 *
 * Singleton service that manages AI message generations in the background.
 * Decouples model execution from React component lifecycle:
 * - Switching conversations or views DOES NOT abort active generations.
 * - Progress (streaming text, reasoning, steps) and final messages are continuously
 *   persisted to localStorage ('griot_messages_${conversationId}') and Supabase.
 * - When users navigate back to the conversation, the UI seamlessly re-attaches.
 * - Only explicit user stops ('stopExecution') abort the active generation.
 */

import { supabase } from "@/integrations/supabase/client";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";
import { executeReActLoop } from "@/lib/runtime/react-loop";
import { streamDirectAI } from "@/lib/ai-client";
import { modelLabel, isModelOS } from "@/lib/griot";
import { observerEngine } from "@/lib/runtime";
import { parseProposals } from "@/lib/capsule-proposals";
import type { GriotProject } from "@/lib/project-service";

export interface ChatMessageRow {
  id: string;
  role: string;
  content: string;
  created_at: string;
  feedback?: string | null;
}

export interface ExecutionState {
  conversationId: string;
  scope: "main" | "quick";
  busy: boolean;
  streaming: string;
  reasoning: string;
  steps: number;
  error?: string | null;
}

export interface StartExecutionParams {
  conversationId: string;
  scope: "main" | "quick";
  userId: string;
  modelId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  userPrompt: string;
  effort?: "low" | "medium" | "high";
  systemInstruction?: string;
  context?: string;
  currentProject?: GriotProject | null;
}

type ExecutionListener = (state: ExecutionState) => void;

interface ActiveExecution {
  controller: AbortController;
  state: ExecutionState;
  listeners: Set<ExecutionListener>;
}

class ChatExecutionManager {
  private activeExecutions = new Map<string, ActiveExecution>();
  private listeners = new Map<string, Set<ExecutionListener>>();

  /** Retorna o estado atual da execução de uma conversa se estiver a decorrer */
  public getExecutionState(conversationId: string): ExecutionState | null {
    const active = this.activeExecutions.get(conversationId);
    return active ? { ...active.state } : null;
  }

  /** Verifica se uma conversa específica tem geração ativa */
  public isExecuting(conversationId: string): boolean {
    return this.activeExecutions.has(conversationId);
  }

  /** Subscreve a atualizações de uma conversa específica de forma persistente */
  public subscribe(conversationId: string, listener: ExecutionListener): () => void {
    if (!this.listeners.has(conversationId)) {
      this.listeners.set(conversationId, new Set());
    }
    const set = this.listeners.get(conversationId)!;
    set.add(listener);

    // Emite o estado atual imediatamente (seja ativo ou ocioso)
    const active = this.activeExecutions.get(conversationId);
    if (active) {
      listener({ ...active.state });
    } else {
      listener({
        conversationId,
        scope: "main",
        busy: false,
        streaming: "",
        reasoning: "",
        steps: 0,
      });
    }

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(conversationId);
      }
    };
  }

  /** Cancela explicitamente uma geração ativa para uma conversa */
  public stopExecution(conversationId: string): void {
    const active = this.activeExecutions.get(conversationId);
    if (!active) return;

    try {
      active.controller.abort();
    } catch {}

    // Se já havia texto gerado, guarda o fragmento até ao momento
    if (active.state.streaming.trim()) {
      void this.finalizeAssistantMessage(
        conversationId,
        active.state.streaming.trim(),
        "anonymous",
        "custom",
      );
    }

    this.activeExecutions.delete(conversationId);
    this.notify(conversationId, {
      ...active.state,
      busy: false,
      streaming: "",
      reasoning: "",
      steps: 0,
    });
  }

  /** Inicia a geração de mensagem em background */
  public async startExecution(params: StartExecutionParams): Promise<void> {
    const {
      conversationId,
      scope,
      userId,
      modelId,
      messages: baseMessages,
      userPrompt,
      effort = "medium",
      systemInstruction = "És o GRIOT, o assistente de engenharia de software e inteligência artificial de elite.",
      context,
      currentProject,
    } = params;

    // Se já houver execução ativa para esta conversa, não duplica
    if (this.activeExecutions.has(conversationId)) {
      return;
    }

    const controller = new AbortController();
    const active: ActiveExecution = {
      controller,
      state: {
        conversationId,
        scope,
        busy: true,
        streaming: "",
        reasoning: "",
        steps: 0,
      },
      listeners: new Set(),
    };

    this.activeExecutions.set(conversationId, active);
    this.notify(conversationId, { ...active.state });

    // 1. Registar a mensagem do utilizador localmente apenas se ainda não existir
    if (userPrompt && userPrompt.trim()) {
      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const userMsg: ChatMessageRow = {
        id: userMsgId,
        role: "user",
        content: userPrompt,
        created_at: new Date().toISOString(),
        feedback: null,
      };
      this.appendMessageLocally(conversationId, userMsg);

      // Salva a mensagem do utilizador no Supabase em segundo plano
      void (async () => {
        try {
          const workspaceId = await getPrimaryWorkspaceId(userId);
          await (supabase as any).from("griot_messages").insert({
            id: userMsgId,
            workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
            conversation_id: conversationId,
            actor_kind: "human",
            content: userPrompt,
            status: "succeeded",
          });
        } catch {}
      })();
    }

    let answer = "";
    let fullReasoning = "";
    let effectiveModelId = modelId;
    let effectiveSystemInstruction = systemInstruction;

    // Prepara mensagens garantindo que o prompt do utilizador está presente sem duplicar
    const effectiveMessages: ChatMessage[] = baseMessages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
    const lastMsg = effectiveMessages[effectiveMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || lastMsg.content.trim() !== userPrompt.trim()) {
      if (userPrompt && userPrompt.trim()) {
        effectiveMessages.push({ role: "user", content: userPrompt.trim() });
      }
    }

    try {
      const isFastMode = effort === "low" || scope === "quick";
      const mLabel = isModelOS(modelId) ? "ModelOS" : modelLabel(modelId);

      // Em modo rápido, executa chamada direta ultrarrápida sem passar pelo ReAct loop iterativo
      if (isFastMode) {
        const directRes = await streamDirectAI({
          modelId: effectiveModelId,
          messages: effectiveMessages,
          systemInstruction: effectiveSystemInstruction,
          callbacks: {
            onToken: (tok) => {
              if (controller.signal.aborted) return;
              answer += tok;
              active.state.streaming = answer;
              this.notify(conversationId, { ...active.state });
            },
            onReasoning: (r) => {
              if (controller.signal.aborted) return;
              fullReasoning += r;
              active.state.reasoning = fullReasoning;
              this.notify(conversationId, { ...active.state });
            },
          },
          signal: controller.signal,
        });

        if (directRes.text && !answer.trim()) {
          answer = directRes.text;
          active.state.streaming = answer;
          this.notify(conversationId, { ...active.state });
        }
      } else {
        // Modo equilibrado / profundo: ReAct loop resiliente
        const loopResult = await executeReActLoop({
          modelId: effectiveModelId,
          messages: effectiveMessages,
          systemInstruction: effectiveSystemInstruction,
          context,
          maxIterations: 2,
          callbacks: {
            onToken: (tok) => {
              if (controller.signal.aborted) return;
              answer += tok;
              active.state.streaming = answer;
              this.notify(conversationId, { ...active.state });
            },
            onReasoning: (r) => {
              if (controller.signal.aborted) return;
              fullReasoning += r;
              active.state.reasoning = fullReasoning;
              this.notify(conversationId, { ...active.state });
            },
            onStepChange: (st) => {
              if (controller.signal.aborted) return;
              active.state.steps = st;
              this.notify(conversationId, { ...active.state });
            },
          },
          signal: controller.signal,
        });

        if (loopResult.finalAnswer) {
          answer = loopResult.finalAnswer;
          active.state.streaming = answer;
          this.notify(conversationId, { ...active.state });
        }
      }

      // Se por qualquer anomalia de rede a resposta ficou vazia
      if (!answer.trim() && !controller.signal.aborted) {
        answer = `⚠️ **O modelo de IA não devolveu resposta.**\n\nPor favor verifica a tua ligação à Internet e a chave de API em **Definições**.`;
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        return;
      }
      console.warn("[ChatExecutionManager] Falha na execução da IA:", err);
      const mLabel = isModelOS(modelId) ? "ModelOS" : modelLabel(modelId);
      answer = `⚠️ **Não foi possível obter resposta do modelo ${mLabel}.**\n\n${err?.message || "Ocorreu uma falha na ligação com o fornecedor de IA."}\n\n👉 Verifica a tua ligação à rede e a tua chave em **Definições → Chave Google Gemini**.`;
    } finally {
      // 2. Finalizar e salvar a mensagem do assistente localmente e no Supabase
      if (!controller.signal.aborted && answer.trim()) {

        const cleaned = parseProposals(answer).clean || answer;

        let appKey = "custom";
        if (isModelOS(modelId)) {
          appKey = "modelos";
        } else {
          const m = modelId.toLowerCase();
          appKey = m.includes("claude")
            ? "claude"
            : m.includes("gemini")
              ? "gemini"
              : m.includes("gpt")
                ? "chatgpt"
                : m.includes("deepseek")
                  ? "deepseek"
                  : m.includes("groq")
                    ? "groq"
                    : "custom";
        }

        try {
          void observerEngine.processIncomingAIMessage(
            {
              provider: appKey as any,
              model: modelId,
              sessionTitle: isModelOS(modelId) ? "ModelOS Cluster" : "Sessão Ativa",
              appId: appKey,
            },
            cleaned,
            conversationId || "main",
          );
        } catch (obsErr) {
          console.warn("[ChatExecutionManager] Observer non-critical:", obsErr);
        }

        await this.finalizeAssistantMessage(conversationId, cleaned, userId, isModelOS(modelId) ? "modelos" : modelId);
      }

      // Desregistar execução ativa
      this.activeExecutions.delete(conversationId);
      this.notify(conversationId, {
        conversationId,
        scope,
        busy: false,
        streaming: "",
        reasoning: "",
        steps: 0,
      });

      // Disparar evento para a UI atualizar lista de conversas
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("griot_conversations_changed"));
      }
    }
  }

  /** Adiciona mensagem localmente de forma resiliente e síncrona */
  private appendMessageLocally(conversationId: string, msg: ChatMessageRow): void {
    if (typeof window === "undefined" || !conversationId) return;
    try {
      const storageKey = "griot_messages_" + conversationId;
      const raw = localStorage.getItem(storageKey);
      const list: ChatMessageRow[] = raw ? JSON.parse(raw) : [];

      // Evita duplicação por ID
      if (list.some((m) => m.id === msg.id)) return;

      // Evita duplicar se a última mensagem já tiver o mesmo papel e conteúdo idêntico
      const last = list[list.length - 1];
      if (last && last.role === msg.role && last.content.trim() === msg.content.trim()) {
        return;
      }

      list.push(msg);
      localStorage.setItem(storageKey, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent("griot_message_saved", { detail: { conversationId, msg } }));
    } catch (e) {
      console.warn("[ChatExecutionManager] Erro ao gravar localmente:", e);
    }
  }

  /** Finaliza a gravação da mensagem do assistente */
  private async finalizeAssistantMessage(
    conversationId: string,
    content: string,
    userId: string,
    modelId: string,
  ): Promise<void> {
    const asstId = `asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const asstMsg: ChatMessageRow = {
      id: asstId,
      role: "assistant",
      content,
      created_at: new Date().toISOString(),
      feedback: null,
    };

    // 1. Gravação local imediata (disponível instantaneamente mesmo offline ou ao navegar)
    this.appendMessageLocally(conversationId, asstMsg);

    // 2. Gravação no Supabase em segundo plano
    try {
      const workspaceId = await getPrimaryWorkspaceId(userId);
      await (supabase as any).from("griot_messages").insert({
        id: asstId,
        workspace_id: workspaceId || "c92b4b86-2ff1-4259-bc16-3ab66751d8b1",
        conversation_id: conversationId,
        actor_kind: "model",
        content,
        status: "succeeded",
        metadata: { model: modelId },
      });

      // Atualiza timestamp da conversa
      await (supabase as any)
        .from("griot_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    } catch (supabaseErr) {
      console.warn("[ChatExecutionManager] Sincronização Supabase em background:", supabaseErr);
    }
  }

  private notify(conversationId: string, state: ExecutionState): void {
    const active = this.activeExecutions.get(conversationId);
    if (active) {
      active.state = { ...state };
    }
    const set = this.listeners.get(conversationId);
    if (set) {
      for (const listener of set) {
        try {
          listener({ ...state });
        } catch (e) {
          console.warn("[ChatExecutionManager] Listener error:", e);
        }
      }
    }
  }
}

export const chatExecutionManager = new ChatExecutionManager();
