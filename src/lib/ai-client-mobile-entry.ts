import { supabase } from "@/integrations/supabase/client";
import { GRIOT_SUPABASE_ANON_KEY, GRIOT_SUPABASE_URL } from "@/lib/griot-api";
import type { ChatMessage, StreamCallbacks, AIResponse } from "./ai-client";
import {
  GEMINI_TOOL_DECLARATIONS,
  OPENAI_TOOLS,
  getSavedApiKey,
  getAnyConfiguredApiKey,
  resolveProviderAndModel,
  isMobileOrCapacitor,
  sanitizeGeminiContents,
  sanitizeAnthropicMessages,
  streamDirectAI as streamCoreDirectAI,
} from "./ai-client";

export type { ChatMessage, StreamCallbacks, AIResponse };
export {
  GEMINI_TOOL_DECLARATIONS,
  OPENAI_TOOLS,
  getSavedApiKey,
  getAnyConfiguredApiKey,
  resolveProviderAndModel,
  isMobileOrCapacitor,
  sanitizeGeminiContents,
  sanitizeAnthropicMessages,
};

function createTimeoutSignal(ms: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout após ${Math.round(ms / 1000)}s`)), ms);
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

function normalizeBackendModel(provider: string, modelName: string): string {
  if (provider !== "gemini") return modelName;
  if (/^gemini-(?:1\.5|2\.0)-/i.test(modelName)) return "gemini-3.6-flash";
  if (!/^gemini-/i.test(modelName)) return "gemini-3.6-flash";
  return modelName;
}

async function streamMobileOrchestrator(params: {
  modelId: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
  executionMode?: "quick" | "orchestrated";
}): Promise<AIResponse> {
  const {
    modelId,
    messages,
    systemInstruction = "",
    callbacks,
    signal,
    executionMode = "orchestrated",
  } = params;

  // Quick must be a real fast path. It uses the existing direct provider client
  // and intentionally bypasses the full Supabase Orchestrator/OPB/GCU pipeline.
  if (executionMode === "quick") {
    console.log("[GRIOT_DEBUG] MOBILE_QUICK_DIRECT_PATH", { modelId });
    return streamCoreDirectAI({
      modelId,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  const modelOs = /^(modelos|model-os)$/i.test(modelId.trim()) || modelId.toLowerCase().includes("modelos");
  const resolved = resolveProviderAndModel(modelId);
  const provider = modelOs ? "gemini" : resolved.provider;
  const modelName = normalizeBackendModel(provider, modelOs ? "gemini-3.6-flash" : resolved.modelName);

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(`Sessão GRIOT indisponível: ${sessionError.message}`);
  }
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Sessão GRIOT expirada. Inicia sessão novamente para conversar.");
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUser?.content?.trim() || "";
  if (!prompt) throw new Error("Mensagem do utilizador vazia.");

  const payloadMessages = messages
    .filter((m) => m.role !== "tool" && m.content?.trim())
    .slice(-24)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const body = {
    prompt,
    messages: payloadMessages,
    provider,
    model: modelName,
    temperature: 0.2,
    maxOutputTokens: 4096,
    autoFabric: false,
  };

  console.log("[GRIOT_DEBUG] MOBILE_CANONICAL_ORCHESTRATOR_START", {
    provider,
    model: modelName,
    promptChars: prompt.length,
  });

  const { signal: safeSignal, cleanup } = createTimeoutSignal(20000, signal);
  let response: Response;
  const startedAt = Date.now();
  try {
    response = await fetch(`${GRIOT_SUPABASE_URL}/functions/v1/griot-orchestrator/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: GRIOT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: safeSignal,
    });

    console.log("[GRIOT_DEBUG] MOBILE_CANONICAL_ORCHESTRATOR_RESPONSE", {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    });

    const rawText = await response.text();

    let payload: any = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`Orquestrador devolveu resposta inválida (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(String(payload.error || `Orquestrador GRIOT devolveu HTTP ${response.status}.`));
    }

    const text = String(payload.result?.content || payload.message?.content || "").trim();
    if (!text) {
      throw new Error("Orquestrador GRIOT terminou sem devolver conteúdo.");
    }

    console.log("[GRIOT_DEBUG] MOBILE_CANONICAL_ORCHESTRATOR_DONE", {
      chars: text.length,
      requestId: payload.requestId || null,
      elapsedMs: Date.now() - startedAt,
    });

    for (const tokenText of text.split(/(\s+)/)) {
      if (!tokenText) continue;
      if (signal?.aborted || safeSignal.aborted) throw new DOMException("Operação cancelada.", "AbortError");
      callbacks?.onToken?.(tokenText);
      await new Promise((resolve) => setTimeout(resolve, 6));
    }

    if (payload.result?.usage) {
      const usage = payload.result.usage;
      callbacks?.onReasoning?.(
        usage.totalTokens ? `\n[GRIOT] ${usage.totalTokens} tokens processados.` : "",
      );
    }

    return { text, reasoning: "", toolCalls: [] };
  } catch (error) {
    if (safeSignal.aborted && !signal?.aborted) {
      throw new Error("O orquestrador GRIOT excedeu o limite de 20s durante a resposta.");
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function streamDirectAI(params: {
  modelId: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
  executionMode?: "quick" | "orchestrated";
}): Promise<AIResponse> {
  if (isMobileOrCapacitor()) {
    return streamMobileOrchestrator(params);
  }

  const coreModule = await import("./ai-client");
  return coreModule.streamDirectAI(params);
}
