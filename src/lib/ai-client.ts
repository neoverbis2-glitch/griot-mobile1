/**
 * GRIOT Direct AI Client
 *
 * Runs directly on Android WebView / Web without depending on local /api/chat.
 * Calls official AI REST endpoints (Gemini, OpenAI, Groq, DeepSeek) with direct keys,
 * with graceful fallback to Supabase Edge Function griot-orchestrator.
 */

import { supabase } from "@/integrations/supabase/client";
import { GRIOT_SUPABASE_URL, GRIOT_SUPABASE_ANON_KEY } from "@/lib/griot-api";
import type { GriotAction, GriotActionType } from "./runtime/protocol";

export const GEMINI_MODELS_CASCADE = [
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
] as const;

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onReasoning?: (reasoning: string) => void;
  onStep?: () => void;
}

export interface AIResponse {
  text: string;
  reasoning: string;
  toolCalls: GriotAction[];
}

/** Declarações de Ferramentas Nativas para Gemini */
export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: "shell_exec",
    description: "Executa um comando na shell do workspace (ex: npm install, git status, build).",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "O comando shell a executar." },
      },
      required: ["command"],
    },
  },
  {
    name: "fs_read_file",
    description: "Lê o conteúdo textual de um ficheiro no projeto.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Caminho relativo do ficheiro (ex: src/App.tsx)." },
      },
      required: ["path"],
    },
  },
  {
    name: "fs_write_file",
    description: "Cria ou substitui completamente o conteúdo de um ficheiro no projeto.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Caminho relativo do ficheiro." },
        content: { type: "STRING", description: "Conteúdo completo a gravar." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_read_tree",
    description: "Lista a estrutura de diretórios e ficheiros do projeto.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Diretório base a listar (padrão: .)" },
      },
    },
  },
  {
    name: "test_run",
    description: "Executa a suíte de testes do projeto e devolve os resultados.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "Comando de teste (ex: npm test)." },
      },
    },
  },
];

/** Declarações de Ferramentas Nativas para OpenAI / Groq / DeepSeek */
export const OPENAI_TOOLS = GEMINI_TOOL_DECLARATIONS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [
          k,
          {
            type: (v as { type: string }).type.toLowerCase(),
            description: (v as { description: string }).description,
          },
        ]),
      ),
      required: t.parameters.required || [],
    },
  },
}));

import { findApiByIdOrProvider, getUserSavedApis } from "@/lib/user-apis";

/** Procura chave guardada localmente exclusivamente para o provedor solicitado */
export function getSavedApiKey(provider: string): string | null {
  if (typeof window === "undefined") return null;

  // 1. Tenta encontrar nas APIs do utilizador
  const saved = findApiByIdOrProvider(provider);
  if (saved?.apiKey) return saved.apiKey;

  // 2. Chaves específicas do provedor
  const prov = provider.toLowerCase();
  const keysToTry = [`griot_api_key_${prov}`, `griot_${prov}_api_key`];
  if (prov === "claude" || prov === "anthropic") {
    keysToTry.push(
      "griot_api_key_anthropic",
      "griot_anthropic_api_key",
      "griot_api_key_claude",
      "griot_claude_api_key",
    );
  } else if (prov === "grok" || prov === "xai") {
    keysToTry.push(
      "griot_api_key_grok",
      "griot_grok_api_key",
      "griot_api_key_xai",
      "griot_xai_api_key",
    );
  }

  for (const k of keysToTry) {
    const val = localStorage.getItem(k)?.trim();
    if (val && val.length > 5) return val;
  }

  return null;
}

/** Retorna a primeira chave de API configurada no sistema (para fallback seguro se o modelo escolhido não tiver chave própria) */
export function getAnyConfiguredApiKey(): {
  provider: string;
  apiKey: string;
  modelName?: string;
} | null {
  if (typeof window === "undefined") return null;

  try {
    const savedApis = getUserSavedApis();
    const active = savedApis.find((a) => a.status === "active" && a.apiKey);
    if (active)
      return { provider: active.providerId, apiKey: active.apiKey, modelName: active.model };
  } catch {}

  const gemini =
    localStorage.getItem("griot_api_key_gemini")?.trim() ||
    localStorage.getItem("griot_gemini_api_key")?.trim();
  if (gemini && gemini.length > 5)
    return { provider: "gemini", apiKey: gemini, modelName: "gemini-2.5-flash" };

  const openAi =
    localStorage.getItem("griot_api_key_openai")?.trim() ||
    localStorage.getItem("griot_openai_api_key")?.trim();
  if (openAi && openAi.length > 5)
    return { provider: "openai", apiKey: openAi, modelName: "gpt-4o" };

  const anthropic =
    localStorage.getItem("griot_api_key_anthropic")?.trim() ||
    localStorage.getItem("griot_api_key_claude")?.trim();
  if (anthropic && anthropic.length > 5)
    return { provider: "anthropic", apiKey: anthropic, modelName: "claude-3-5-sonnet-latest" };

  const groq =
    localStorage.getItem("griot_api_key_groq")?.trim() ||
    localStorage.getItem("griot_groq_api_key")?.trim();
  if (groq && groq.length > 5)
    return { provider: "groq", apiKey: groq, modelName: "llama-3.3-70b-versatile" };

  const deepseek =
    localStorage.getItem("griot_api_key_deepseek")?.trim() ||
    localStorage.getItem("griot_deepseek_api_key")?.trim();
  if (deepseek && deepseek.length > 5)
    return { provider: "deepseek", apiKey: deepseek, modelName: "deepseek-chat" };

  return null;
}

/** Mapeia nomes amigáveis para endpoints de IA */
export function resolveProviderAndModel(modelId: string): {
  provider: string;
  modelName: string;
  specificApiKey?: string;
} {
  // Se for um ID de API adicionada pelo utilizador
  const userApi = findApiByIdOrProvider(modelId);
  if (userApi) {
    const prov = userApi.providerId;
    let mName = "gemini-flash-latest";
    if (prov === "openai") mName = "gpt-4o";
    else if (prov === "claude" || prov === "anthropic") mName = "claude-3-5-sonnet-latest";
    else if (prov === "deepseek") mName = "deepseek-chat";
    else if (prov === "groq") mName = "llama-3.3-70b-versatile";
    else if (prov === "openrouter") mName = userApi.model || "google/gemini-flash-latest";
    else if (prov === "mistral") mName = "mistral-large-latest";
    else if (prov === "perplexity") mName = "sonar-pro";
    else if (prov === "grok" || prov === "xai") mName = "grok-2-latest";
    else if (prov === "gemini") {
      const declared = (userApi.model || "").toLowerCase();
      if (declared.includes("3.7")) mName = "gemini-3.7-flash";
      else if (declared.includes("3.6")) mName = "gemini-3.6-flash";
      else if (declared.includes("3.1-pro") || declared.includes("pro"))
        mName = "gemini-3.1-pro-preview";
      else if (declared.includes("lite")) mName = "gemini-3.1-flash-lite";
      else if (declared.includes("2.5")) mName = "gemini-2.5-flash";
      else mName = "gemini-flash-latest";
    }
    return { provider: prov, modelName: mName, specificApiKey: userApi.apiKey };
  }

  const m = modelId.toLowerCase();
  if (m === "modelos" || m === "model-os" || m.includes("modelos")) {
    const anyKey = getAnyConfiguredApiKey();
    if (anyKey) {
      return {
        provider: anyKey.provider,
        modelName:
          anyKey.modelName || (anyKey.provider === "gemini" ? "gemini-flash-latest" : "gpt-4o"),
        specificApiKey: anyKey.apiKey,
      };
    }
    return { provider: "gemini", modelName: "gemini-flash-latest" };
  }
  if (m.includes("gemini")) {
    const name = m.includes("3.7")
      ? "gemini-3.7-flash"
      : m.includes("3.6")
        ? "gemini-3.6-flash"
        : m.includes("3.1-pro") || m.includes("pro")
          ? "gemini-3.1-pro-preview"
          : m.includes("lite")
            ? "gemini-3.1-flash-lite"
            : m.includes("2.5")
              ? "gemini-2.5-flash"
              : "gemini-flash-latest";
    return { provider: "gemini", modelName: name };
  }
  if (m.includes("gpt-4o") || m.includes("openai") || m.includes("o1") || m.includes("o3")) {
    const name = m.includes("mini") ? "gpt-4o-mini" : "gpt-4o";
    return { provider: "openai", modelName: name };
  }
  if (m.includes("deepseek")) {
    const name = m.includes("reasoner") || m.includes("r1") ? "deepseek-reasoner" : "deepseek-chat";
    return { provider: "deepseek", modelName: name };
  }
  if (m.includes("claude") || m.includes("anthropic")) {
    const name = m.includes("haiku") ? "claude-3-5-haiku-latest" : "claude-3-5-sonnet-latest";
    return { provider: "anthropic", modelName: name };
  }
  if (m.includes("groq") || m.includes("llama")) {
    return { provider: "groq", modelName: "llama-3.3-70b-versatile" };
  }
  if (m.includes("openrouter")) {
    return { provider: "openrouter", modelName: "google/gemini-2.5-flash" };
  }
  if (m.includes("grok") || m.includes("xai")) {
    return { provider: "xai", modelName: "grok-2-latest" };
  }
  if (m.includes("mistral")) {
    return { provider: "mistral", modelName: "mistral-large-latest" };
  }
  if (m.includes("perplexity")) {
    return { provider: "perplexity", modelName: "sonar-pro" };
  }
  return { provider: "gemini", modelName: "gemini-2.5-flash" };
}

/**
 * Deteta com precisão se a execução decorre em ambiente móvel nativo (Android Capacitor, iOS ou WebView móvel).
 */
export function isMobileOrCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:" ||
    window.location.hostname === "localhost" ||
    Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
    /android|iphone|ipad|mobile/i.test(navigator.userAgent)
  );
}

/**
 * Envia um prompt com histórico diretamente para a API de IA configurada pelo utilizador.
 * Suporta streaming de texto, raciocínio e chamada de ferramentas nativas.
 */
export async function streamDirectAI(params: {
  modelId: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const isMobile = isMobileOrCapacitor();
  console.log("[GRIOT_DEBUG] streamDirectAI: entrou", { modelId: params.modelId, isMobile });

  const { modelId, messages, systemInstruction, callbacks, signal } = params;
  const resolved = resolveProviderAndModel(modelId);
  let activeProvider = resolved.provider;
  let activeModelName = resolved.modelName;
  let effectiveKey = resolved.specificApiKey || getSavedApiKey(activeProvider);

  // Se o utilizador pediu um provedor sem chave direta, verifica se existe qualquer outra chave configurada no app
  if (!effectiveKey) {
    const anyKey = getAnyConfiguredApiKey();
    if (anyKey && anyKey.apiKey) {
      activeProvider = anyKey.provider;
      effectiveKey = anyKey.apiKey;
      if (activeProvider === "gemini") {
        activeModelName = anyKey.modelName || "gemini-2.5-flash";
      } else if (activeProvider === "openai") {
        activeModelName = anyKey.modelName || "gpt-4o";
      } else if (activeProvider === "claude" || activeProvider === "anthropic") {
        activeModelName = anyKey.modelName || "claude-3-5-sonnet-latest";
      } else if (activeProvider === "groq") {
        activeModelName = anyKey.modelName || "llama-3.3-70b-versatile";
      } else if (activeProvider === "deepseek") {
        activeModelName = anyKey.modelName || "deepseek-chat";
      }
      callbacks?.onReasoning?.(
        `⚡ [Roteador GRIOT] A mobilizar ${activeProvider.toUpperCase()} (${activeModelName}) com base na tua chave de API ativa.\n`,
      );
    }
  }

  // Se ainda assim não há nenhuma chave configurada no dispositivo, utiliza os gateways do sistema
  if (!effectiveKey) {
    return streamSupabaseOrchestratorFallback({
      provider: activeProvider,
      modelName: activeModelName,
      messages,
      callbacks,
      signal,
    });
  }

  // 1. Chamada direta ao Google Gemini com recuperação resiliente
  if (activeProvider === "gemini") {
    try {
      return await streamGeminiDirect({
        apiKey: effectiveKey,
        modelName: activeModelName,
        messages,
        systemInstruction,
        callbacks,
        signal,
      });
    } catch (geminiErr: any) {
      console.warn("[GRIOT_DEBUG] Chamada direta Gemini falhou:", geminiErr);

      if (signal?.aborted) {
        throw geminiErr;
      }

      // Se o erro for 403 (PERMISSION_DENIED), 401 ou 429:
      // 1. Tenta outras chaves de API salvas pelo utilizador se existirem
      const otherApis = getUserSavedApis().filter(
        (a) => a.apiKey && a.apiKey !== effectiveKey && a.status !== "error",
      );
      for (const altApi of otherApis) {
        try {
          console.log(`[GRIOT_DEBUG] Tentando chave alternativa (${altApi.providerId})...`);
          callbacks?.onReasoning?.(
            `⚡ [GRIOT] Chave anterior indisponível. A tentar credencial alternativa (${altApi.label || altApi.providerId})...\n`,
          );
          return await streamDirectAI({
            ...params,
            modelId: `${altApi.providerId}:${altApi.model || "default"}`,
          });
        } catch (altErr) {
          console.warn(`[GRIOT_DEBUG] Chave alternativa ${altApi.id} também falhou:`, altErr);
        }
      }

      // 2. Fallback de salvaguarda seguro para o endpoint /api/chat do servidor
      console.log("[GRIOT_DEBUG] Recorrendo a streamSupabaseOrchestratorFallback (/api/chat)...");
      callbacks?.onReasoning?.(
        "⚡ [GRIOT] Chave local com restrições (403). A utilizar o gateway seguro do servidor para concluir a resposta...\n",
      );
      try {
        return await streamSupabaseOrchestratorFallback({
          provider: "gemini",
          modelName: "gemini-flash-latest",
          messages,
          systemInstruction,
          callbacks,
          signal,
        });
      } catch (fallbackErr) {
        console.error("[GRIOT_DEBUG] Fallback seguro do servidor também falhou:", fallbackErr);
        throw geminiErr;
      }
    }
  }

  // 2. Chamada direta ao OpenAI
  if (activeProvider === "openai") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.openai.com/v1",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 3. Chamada direta ao Groq
  if (activeProvider === "groq") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.groq.com/openai/v1",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 4. Chamada direta ao DeepSeek
  if (activeProvider === "deepseek") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.deepseek.com",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 5. Chamada direta ao OpenRouter
  if (activeProvider === "openrouter") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 6. Chamada direta ao Grok / xAI
  if (activeProvider === "grok" || activeProvider === "xai") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.x.ai/v1",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 7. Chamada direta ao Mistral
  if (activeProvider === "mistral") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.mistral.ai/v1",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 8. Chamada direta ao Perplexity
  if (activeProvider === "perplexity") {
    return streamOpenAIDirect({
      apiKey: effectiveKey,
      baseUrl: "https://api.perplexity.ai",
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 9. Chamada direta ao Anthropic Claude
  if (activeProvider === "claude" || activeProvider === "anthropic") {
    return streamAnthropicDirect({
      apiKey: effectiveKey,
      modelName: activeModelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 10. Fallback para Supabase Edge Function se autenticado
  return streamSupabaseOrchestratorFallback({
    provider: activeProvider,
    modelName: activeModelName,
    messages,
    callbacks,
    signal,
  });
}

function createSafeTimeoutSignal(
  ms: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`Timeout após ${Math.round(ms / 1000)}s`));
  }, ms);

  const onAbort = () => {
    clearTimeout(timer);
    ctrl.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      ctrl.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Sanitiza e coalesça mensagens para a API Gemini (garantindo alternância estrita user -> model -> user) */
export function sanitizeGeminiContents(
  messages: ChatMessage[],
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  const filtered = messages
    .filter((m) => m.role !== "system" && m.content && m.content.trim().length > 0)
    .map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      text: m.content.trim(),
    }));

  if (filtered.length === 0) {
    return [{ role: "user", parts: [{ text: "Olá" }] }];
  }

  const result: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const item of filtered) {
    const last = result[result.length - 1];
    if (last && last.role === item.role) {
      last.parts[0].text += "\n\n" + item.text;
    } else {
      result.push({
        role: item.role,
        parts: [{ text: item.text }],
      });
    }
  }

  if (result.length > 0 && result[0].role !== "user") {
    result.unshift({ role: "user", parts: [{ text: "Iniciar conversa." }] });
  }

  return result;
}

/** Sanitiza e coalesça mensagens para a API Anthropic Claude (garantindo alternância estrita user -> assistant -> user) */
export function sanitizeAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const filtered = messages
    .filter((m) => m.role !== "system" && m.content && m.content.trim().length > 0)
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: m.content.trim(),
    }));

  if (filtered.length === 0) {
    return [{ role: "user", content: "Olá" }];
  }

  const result: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const item of filtered) {
    const last = result[result.length - 1];
    if (last && last.role === item.role) {
      last.content += "\n\n" + item.content;
    } else {
      result.push({
        role: item.role,
        content: item.content,
      });
    }
  }

  if (result.length > 0 && result[0].role !== "user") {
    result.unshift({ role: "user", content: "Iniciar conversa." });
  }

  return result;
}

/** Chamada síncrona / REST de fallback para Gemini quando streaming SSE é bloqueado ou falha no WebView */
async function fetchGeminiDirectSync(params: {
  apiKey: string;
  modelName: string;
  body: Record<string, unknown>;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
  attemptIndex?: number;
}): Promise<AIResponse> {
  const { apiKey, modelName, body, callbacks, signal, attemptIndex = 0 } = params;

  // Sanitiza o modelName para nunca utilizar modelos legados ou descontinuados
  let targetModel = modelName;
  if (targetModel.includes("2.0") || targetModel.includes("1.5") || !targetModel) {
    targetModel = "gemini-flash-latest";
  }

  const syncEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

  console.log("[GRIOT_DEBUG] fetch REST iniciado", {
    url: syncEndpoint.replace(apiKey, "[REDACTED]"),
    model: targetModel,
    attempt: attemptIndex,
  });

  const { signal: safeSignal, cleanup } = createSafeTimeoutSignal(14000, signal);
  let res: Response;
  try {
    res = await fetch(syncEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: safeSignal,
    });
  } finally {
    cleanup();
  }

  console.log("[GRIOT_DEBUG] fetch REST respondeu", { status: res.status, model: targetModel });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`[GRIOT_DEBUG] REST direct erro ${res.status} em ${targetModel}:`, errText);

    // 1. Se erro 400 (INVALID_ARGUMENT) e tínhamos tools, retenta imediatamente SEM tools
    if (res.status === 400 && body.tools && attemptIndex < 4) {
      console.warn(
        "[GRIOT_DEBUG] Gemini rejeitou ferramentas (400 INVALID_ARGUMENT). Tentando sem tools...",
      );
      const bodyNoTools = { ...body };
      delete bodyNoTools.tools;
      return fetchGeminiDirectSync({
        ...params,
        modelName: targetModel,
        body: bodyNoTools,
        attemptIndex: attemptIndex + 1,
      });
    }

    // 2. Se erro 400 persistir e tiver systemInstruction estruturado, converte para instrução limpa
    if (res.status === 400 && body.systemInstruction && attemptIndex < 4) {
      console.warn(
        "[GRIOT_DEBUG] Gemini erro 400 com systemInstruction. Tentando sem systemInstruction estruturado...",
      );
      const bodyClean = { ...body };
      delete bodyClean.systemInstruction;
      return fetchGeminiDirectSync({
        ...params,
        modelName: targetModel,
        body: bodyClean,
        attemptIndex: attemptIndex + 1,
      });
    }

    // 3. Se modelo for 404 (descontinuado), 400, 403 (permissão do modelo) ou 429, tenta o próximo modelo na cascata
    const candidateModels = GEMINI_MODELS_CASCADE.filter((m) => m !== targetModel);
    if (
      (res.status === 404 || res.status === 400 || res.status === 403 || res.status === 429) &&
      candidateModels.length > 0 &&
      attemptIndex < candidateModels.length
    ) {
      const nextCandidate = candidateModels[attemptIndex % candidateModels.length];
      console.warn(
        `[GRIOT_DEBUG] Alternando de ${targetModel} para ${nextCandidate} (status ${res.status})...`,
      );
      return fetchGeminiDirectSync({
        ...params,
        modelName: nextCandidate,
        attemptIndex: attemptIndex + 1,
      });
    }

    throw new Error(`Google Gemini erro ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let fullText = "";
  let fullReasoning = "";
  const toolCalls: GriotAction[] = [];

  for (const part of parts) {
    if (part.text) {
      if (part.thought) {
        fullReasoning += part.text;
        callbacks?.onReasoning?.(part.text);
      } else {
        fullText += part.text;
      }
    } else if (part.thought) {
      fullReasoning += part.thought;
      callbacks?.onReasoning?.(part.thought);
    }
    if (part.functionCall) {
      callbacks?.onStep?.();
      const fn = part.functionCall;
      const mappedType = mapFunctionNameToActionType(fn.name);
      toolCalls.push({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: mappedType,
        category: mappedType.split(".")[0] as any,
        risk:
          mappedType.startsWith("fs.write") || mappedType.startsWith("shell.")
            ? "sensitive"
            : "safe",
        params: fn.args || {},
        requiresApproval: mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Emite as palavras com micro-delay para animação natural de streaming
  if (fullText) {
    const tokens = fullText.split(/(\s+)/);
    for (const tok of tokens) {
      if (signal?.aborted) break;
      if (tok) {
        callbacks?.onToken?.(tok);
        await new Promise((r) => setTimeout(r, 6));
      }
    }
  }

  return { text: fullText, reasoning: fullReasoning, toolCalls };
}

/** Streaming nativo Google Gemini REST API */
async function streamGeminiDirect(params: {
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { apiKey, modelName, messages, systemInstruction, callbacks, signal } = params;

  if (signal?.aborted) {
    throw new DOMException("Operação cancelada pelo utilizador.", "AbortError");
  }

  // Converte mensagens para o formato do Gemini com alternância estrita garantida
  const contents = sanitizeGeminiContents(messages);

  // Ferramentas só são ativadas se o utilizador solicitar explicitamente operações de ficheiro/shell
  const needsTools = messages.some((m) => {
    const c = (m.content || "").toLowerCase();
    return (
      c.includes("ficheiro") ||
      c.includes("arquivo") ||
      c.includes("terminal") ||
      c.includes("comando") ||
      c.includes("shell") ||
      c.includes("executa") ||
      c.includes("npm ") ||
      c.includes("git ")
    );
  });

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  if (needsTools) {
    body.tools = [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }];
  }

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  // Sanitiza o modelName se for um modelo legado já descontinuado
  let activeModel = modelName;
  if (activeModel.includes("2.0") || activeModel.includes("1.5") || !activeModel) {
    activeModel = "gemini-flash-latest";
  }

  // No WebView móvel nativo (Capacitor/Android), streams SSE por chunked transfer sofrem buffering agressivo no Chromium.
  // Recorrer a REST direto (:generateContent) com token synthesis garante resposta imediata (< 1s) sem travamento de socket.
  if (isMobileOrCapacitor()) {
    return fetchGeminiDirectSync({ apiKey, modelName: activeModel, body, callbacks, signal });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  // Controlador de aborto local interligado ao sinal do utilizador
  const streamAbortController = new AbortController();
  const onParentAbort = () => {
    try {
      streamAbortController.abort();
    } catch {}
  };
  if (signal) {
    if (signal.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    signal.addEventListener("abort", onParentAbort, { once: true });
  }

  let response: Response | null = null;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: streamAbortController.signal,
    });
  } catch (fetchErr: any) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    console.warn("[GRIOT_DEBUG] Falha no streaming SSE do Gemini, tentando REST direto:", fetchErr);
    return fetchGeminiDirectSync({ apiKey, modelName: activeModel, body, callbacks, signal });
  }

  if (!response.ok) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    const errorText = await response.text().catch(() => "");

    // 1. Auto-recuperação inteligente se a Google sugerir um novo modelo no erro 404
    const updateMatch =
      errorText.match(/use models\/([a-zA-Z0-9.-]+)/i) ||
      errorText.match(/models\/([a-zA-Z0-9.-]+)/g);
    let suggestedModel: string | null = null;
    if (updateMatch) {
      if (
        typeof updateMatch[1] === "string" &&
        updateMatch[1] !== activeModel &&
        !updateMatch[1].includes("2.0")
      ) {
        suggestedModel = updateMatch[1];
      } else if (Array.isArray(updateMatch)) {
        for (const m of updateMatch) {
          const clean = m.replace(/^models\//, "");
          if (clean !== activeModel && !clean.includes("2.0") && !clean.includes("1.5")) {
            suggestedModel = clean;
            break;
          }
        }
      }
    }

    if (response.status === 404 && suggestedModel && suggestedModel !== activeModel) {
      console.warn(
        `[GRIOT_DEBUG] Google recomendou o modelo ${suggestedModel}. A auto-recuperar...`,
      );
      return fetchGeminiDirectSync({
        ...params,
        modelName: suggestedModel,
      });
    }

    // 2. Se deu erro 400 (INVALID_ARGUMENT), tenta REST sem ferramentas
    if (response.status === 400 && body.tools) {
      console.warn("[GRIOT_DEBUG] SSE retornou 400 com ferramentas. Tentando REST sem tools...");
      const bodyNoTools = { ...body };
      delete bodyNoTools.tools;
      return fetchGeminiDirectSync({
        apiKey,
        modelName: activeModel,
        body: bodyNoTools,
        callbacks,
        signal,
      });
    }

    // 3. Fallback de passo único para cascata de modelos modernos em caso de 404, 400, 403 ou 429
    if (
      response.status === 404 ||
      response.status === 400 ||
      response.status === 403 ||
      response.status === 429
    ) {
      const nextModel =
        GEMINI_MODELS_CASCADE.find((m) => m !== activeModel) || "gemini-flash-latest";
      console.warn(
        `[GRIOT_DEBUG] Gemini SSE ${response.status} em ${activeModel}. Tentando ${nextModel} via REST direto...`,
      );
      return fetchGeminiDirectSync({
        ...params,
        modelName: nextModel,
      });
    }

    throw new Error(
      `Google Gemini retornou erro ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
    );
  }

  let fullText = "";
  let fullReasoning = "";
  const toolCalls: GriotAction[] = [];

  const reader = response.body?.getReader();
  if (!reader) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    return fetchGeminiDirectSync({ apiKey, modelName, body, callbacks, signal });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAnyToken = false;

  // Watchdog de 4.5 segundos: se o WebView mobile sofrer de buffering SSE e não emitir tokens,
  // cancela o leitor e aborta o stream ativo no socket e invoca imediatamente o endpoint REST direto (:generateContent)
  let watchdogTimer: any = setTimeout(() => {
    if (!receivedAnyToken && !signal?.aborted) {
      console.warn(
        "[GRIOT_DEBUG] Watchdog acionado: sem tokens SSE em 4.5s no WebView móvel. Cancelando reader e recorrendo a REST...",
      );
      try {
        void reader.cancel();
      } catch {}
      try {
        streamAbortController.abort();
      } catch {}
    }
  }, 4500);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Operação cancelada.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.replace(/^data:\s*/, "");
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const payload = JSON.parse(jsonStr);
          const candidates = payload.candidates || [];
          for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                if (!receivedAnyToken) {
                  receivedAnyToken = true;
                  if (watchdogTimer) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                  }
                }
                if (part.thought) {
                  fullReasoning += part.text;
                  callbacks?.onReasoning?.(part.text);
                } else {
                  fullText += part.text;
                  callbacks?.onToken?.(part.text);
                }
              } else if (typeof part.thought === "string") {
                if (!receivedAnyToken) {
                  receivedAnyToken = true;
                  if (watchdogTimer) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                  }
                }
                fullReasoning += part.thought;
                callbacks?.onReasoning?.(part.thought);
              }
              if (part.functionCall) {
                if (!receivedAnyToken) {
                  receivedAnyToken = true;
                  if (watchdogTimer) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                  }
                }
                callbacks?.onStep?.();
                const fn = part.functionCall;
                const mappedType = mapFunctionNameToActionType(fn.name);
                toolCalls.push({
                  id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  type: mappedType,
                  category: mappedType.split(".")[0] as any,
                  risk:
                    mappedType.startsWith("fs.write") || mappedType.startsWith("shell.")
                      ? "sensitive"
                      : "safe",
                  params: fn.args || {},
                  requiresApproval:
                    mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
                  status: "pending",
                  createdAt: new Date().toISOString(),
                });
              }
            }
          }
        } catch {
          // fragmento incompleto
        }
      }
    }
  } catch (streamErr: any) {
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    // Se o stream falhou a meio ou foi abortado pelo watchdog sem devolver resposta, tenta o fallback REST
    if (!fullText.trim()) {
      console.warn(
        "[GRIOT_DEBUG] Stream SSE interrompido, recorrendo ao endpoint REST padrão:",
        streamErr,
      );
      return fetchGeminiDirectSync({ apiKey, modelName, body, callbacks, signal });
    }
  } finally {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (signal) {
      signal.removeEventListener("abort", onParentAbort);
    }
    try {
      void reader.cancel();
    } catch {}
  }

  // Se o stream encerrou sem produzir nenhum texto nem tool calls, não deixar a IA muda:
  if (!fullText.trim() && toolCalls.length === 0 && !signal?.aborted) {
    console.warn(
      "[GRIOT_DEBUG] Stream SSE terminou sem gerar texto, acionando REST direto (:generateContent)...",
    );
    return fetchGeminiDirectSync({ apiKey, modelName, body, callbacks, signal });
  }

  return { text: fullText, reasoning: fullReasoning, toolCalls };
}

/** Fallback não-streaming para OpenAI / Groq / DeepSeek */
async function fetchOpenAIDirectSync(params: {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  formattedMessages: any[];
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
  withoutTools?: boolean;
}): Promise<AIResponse> {
  const { apiKey, baseUrl, modelName, formattedMessages, callbacks, signal, withoutTools } = params;

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const isReasoning =
    modelName.includes("reasoner") ||
    modelName.includes("r1") ||
    modelName.includes("o1") ||
    modelName.includes("o3");

  const needsTools = formattedMessages.some((m) => {
    const c = (m.content || "").toLowerCase();
    return (
      c.includes("ficheiro") ||
      c.includes("arquivo") ||
      c.includes("terminal") ||
      c.includes("comando") ||
      c.includes("shell") ||
      c.includes("executa") ||
      c.includes("npm ") ||
      c.includes("git ")
    );
  });

  const reqBody: Record<string, unknown> = {
    model: modelName,
    messages: formattedMessages,
    stream: false,
  };
  if (needsTools && !withoutTools && !isReasoning) {
    reqBody.tools = OPENAI_TOOLS;
  }

  const { signal: safeSignal, cleanup } = createSafeTimeoutSignal(12000, signal);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
      signal: safeSignal,
    });
  } finally {
    cleanup();
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 400 && !withoutTools) {
      console.warn("[GRIOT] Provedor retornou 400. Re-tentando sem ferramentas...");
      return fetchOpenAIDirectSync({ ...params, withoutTools: true });
    }
    throw new Error(`Provedor de IA erro ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const message = choice?.message;
  let fullText = message?.content || "";
  let fullReasoning = message?.reasoning_content || "";
  const toolCalls: GriotAction[] = [];

  if (message?.tool_calls) {
    callbacks?.onStep?.();
    for (const tc of message.tool_calls) {
      if (tc.function?.name) {
        const mappedType = mapFunctionNameToActionType(tc.function.name);
        let parsedArgs = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = { raw: tc.function.arguments };
        }
        toolCalls.push({
          id: tc.id || `act_${Date.now()}`,
          type: mappedType,
          category: mappedType.split(".")[0] as any,
          risk:
            mappedType.startsWith("fs.write") || mappedType.startsWith("shell.")
              ? "sensitive"
              : "safe",
          params: parsedArgs,
          requiresApproval: mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  if (fullReasoning) {
    callbacks?.onReasoning?.(fullReasoning);
  }

  if (fullText) {
    const tokens = fullText.split(/(\s+)/);
    for (const tok of tokens) {
      if (signal?.aborted) break;
      if (tok) {
        callbacks?.onToken?.(tok);
        await new Promise((r) => setTimeout(r, 6));
      }
    }
  }

  return { text: fullText, reasoning: fullReasoning, toolCalls };
}

/** Streaming nativo OpenAI / Groq / DeepSeek */
async function streamOpenAIDirect(params: {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { apiKey, baseUrl, modelName, messages, systemInstruction, callbacks, signal } = params;

  const formattedMessages: any[] = [];
  if (systemInstruction) {
    formattedMessages.push({ role: "system", content: systemInstruction });
  }
  for (const m of messages) {
    formattedMessages.push({ role: m.role, content: m.content });
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  // No WebView móvel nativo (Android Capacitor/iOS), streams SSE por chunked transfer sofrem buffering agressivo no Chromium.
  // Recorrer a REST direto (/v1/chat/completions) com síntese de streaming de tokens a 6ms garante resposta imediata sem travamentos e poupa créditos.
  if (isMobileOrCapacitor()) {
    return fetchOpenAIDirectSync({
      apiKey,
      baseUrl,
      modelName,
      formattedMessages,
      callbacks,
      signal,
    });
  }

  const isReasoning =
    modelName.includes("reasoner") ||
    modelName.includes("r1") ||
    modelName.includes("o1") ||
    modelName.includes("o3");

  const streamAbortController = new AbortController();
  const overallTimeoutTimer = setTimeout(() => {
    try {
      streamAbortController.abort(new Error("Timeout após 12s"));
    } catch {}
  }, 12000);
  const onParentAbort = () => {
    try {
      streamAbortController.abort();
    } catch {}
  };
  if (signal) {
    if (signal.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const needsTools = formattedMessages.some((m) => {
    const c = (m.content || "").toLowerCase();
    return (
      c.includes("ficheiro") ||
      c.includes("arquivo") ||
      c.includes("terminal") ||
      c.includes("comando") ||
      c.includes("shell") ||
      c.includes("executa") ||
      c.includes("npm ") ||
      c.includes("git ")
    );
  });

  const streamBody: Record<string, unknown> = {
    model: modelName,
    messages: formattedMessages,
    stream: true,
  };
  if (needsTools && !isReasoning) {
    streamBody.tools = OPENAI_TOOLS;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(streamBody),
      signal: streamAbortController.signal,
    });
  } catch (fetchErr: any) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    console.warn(
      "[GRIOT_DEBUG] Falha no streaming SSE de OpenAI/Groq, tentando REST direto:",
      fetchErr,
    );
    return fetchOpenAIDirectSync({
      apiKey,
      baseUrl,
      modelName,
      formattedMessages,
      callbacks,
      signal,
    });
  }

  if (!response.ok) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    const errorText = await response.text().catch(() => "");
    if (
      response.status === 400 &&
      (errorText.includes("tool") || errorText.includes("function") || isReasoning)
    ) {
      console.warn(
        "[GRIOT_DEBUG] Provedor OpenAI rejeitou tools (400), recorrendo a REST sem tools:",
        errorText,
      );
      return fetchOpenAIDirectSync({
        apiKey,
        baseUrl,
        modelName,
        formattedMessages,
        callbacks,
        signal,
        withoutTools: true,
      });
    }
    throw new Error(
      `Provedor de IA retornou erro ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
    );
  }

  let fullText = "";
  let fullReasoning = "";
  const toolCalls: GriotAction[] = [];

  const reader = response.body?.getReader();
  if (!reader) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    return fetchOpenAIDirectSync({
      apiKey,
      baseUrl,
      modelName,
      formattedMessages,
      callbacks,
      signal,
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAnyToken = false;

  let watchdogTimer: any = setTimeout(() => {
    if (!receivedAnyToken && !signal?.aborted) {
      console.warn(
        "[GRIOT_DEBUG] Watchdog acionado: sem tokens OpenAI em 4.5s. Cancelando leitor e abortando stream...",
      );
      try {
        void reader.cancel();
      } catch {}
      try {
        streamAbortController.abort();
      } catch {}
    }
  }, 4500);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Operação cancelada.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") break;

        try {
          const payload = JSON.parse(dataStr);
          const delta = payload.choices?.[0]?.delta;
          if (delta?.content) {
            if (!receivedAnyToken) {
              receivedAnyToken = true;
              if (watchdogTimer) {
                clearTimeout(watchdogTimer);
                watchdogTimer = null;
              }
            }
            fullText += delta.content;
            callbacks?.onToken?.(delta.content);
          }
          if (delta?.reasoning_content) {
            if (!receivedAnyToken) {
              receivedAnyToken = true;
              if (watchdogTimer) {
                clearTimeout(watchdogTimer);
                watchdogTimer = null;
              }
            }
            fullReasoning += delta.reasoning_content;
            callbacks?.onReasoning?.(delta.reasoning_content);
          }
          if (delta?.tool_calls) {
            if (!receivedAnyToken) {
              receivedAnyToken = true;
              if (watchdogTimer) {
                clearTimeout(watchdogTimer);
                watchdogTimer = null;
              }
            }
            callbacks?.onStep?.();
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                const mappedType = mapFunctionNameToActionType(tc.function.name);
                let parsedArgs = {};
                try {
                  parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                } catch {
                  parsedArgs = { raw: tc.function.arguments };
                }
                toolCalls.push({
                  id: tc.id || `act_${Date.now()}`,
                  type: mappedType,
                  category: mappedType.split(".")[0] as any,
                  risk:
                    mappedType.startsWith("fs.write") || mappedType.startsWith("shell.")
                      ? "sensitive"
                      : "safe",
                  params: parsedArgs,
                  requiresApproval:
                    mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
                  status: "pending",
                  createdAt: new Date().toISOString(),
                });
              }
            }
          }
        } catch {
          // fragmento incompleto
        }
      }
    }
  } catch (streamErr: any) {
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    if (!fullText.trim()) {
      console.warn(
        "[GRIOT_DEBUG] Stream OpenAI interrompido ou em buffer, recorrendo ao endpoint REST padrão:",
        streamErr,
      );
      return fetchOpenAIDirectSync({
        apiKey,
        baseUrl,
        modelName,
        formattedMessages,
        callbacks,
        signal,
      });
    }
  } finally {
    clearTimeout(overallTimeoutTimer);
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (signal) {
      signal.removeEventListener("abort", onParentAbort);
    }
    try {
      void reader.cancel();
    } catch {}
  }

  if (!fullText.trim() && toolCalls.length === 0 && !signal?.aborted) {
    console.warn("[GRIOT_DEBUG] Stream OpenAI terminou sem texto, recorrendo a REST direto...");
    return fetchOpenAIDirectSync({
      apiKey,
      baseUrl,
      modelName,
      formattedMessages,
      callbacks,
      signal,
    });
  }

  return { text: fullText, reasoning: fullReasoning, toolCalls };
}

/** Fallback não-streaming para Anthropic Claude */
async function fetchAnthropicDirectSync(params: {
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { apiKey, modelName, messages, systemInstruction, callbacks, signal } = params;
  const endpoint = "https://api.anthropic.com/v1/messages";

  const anthropicMessages = sanitizeAnthropicMessages(messages);

  const { signal: safeSignal, cleanup } = createSafeTimeoutSignal(12000, signal);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        ...(systemInstruction ? { system: systemInstruction } : {}),
        messages: anthropicMessages,
      }),
      signal: safeSignal,
    });
  } finally {
    cleanup();
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic Claude erro ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  const fullText = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  if (fullText) {
    const tokens = fullText.split(/(\s+)/);
    for (const tok of tokens) {
      if (signal?.aborted) break;
      if (tok) {
        callbacks?.onToken?.(tok);
        await new Promise((r) => setTimeout(r, 6));
      }
    }
  }

  return { text: fullText, toolCalls: [] };
}

/** Streaming nativo Anthropic Claude */
async function streamAnthropicDirect(params: {
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { apiKey, modelName, messages, systemInstruction, callbacks, signal } = params;

  if (signal?.aborted) {
    throw new DOMException("Operação cancelada pelo utilizador.", "AbortError");
  }

  const anthropicMessages = sanitizeAnthropicMessages(messages);

  // No WebView móvel nativo (Android Capacitor/iOS), streams SSE por chunked transfer sofrem buffering agressivo no Chromium.
  // Recorrer a REST direto (/v1/messages) com síntese de streaming de tokens a 6ms garante resposta imediata sem travamentos e poupa créditos.
  if (isMobileOrCapacitor()) {
    return fetchAnthropicDirectSync(params);
  }

  const endpoint = "https://api.anthropic.com/v1/messages";
  const streamAbortController = new AbortController();
  const overallTimeoutTimer = setTimeout(() => {
    try {
      streamAbortController.abort(new Error("Timeout após 12s"));
    } catch {}
  }, 12000);
  const onParentAbort = () => {
    try {
      streamAbortController.abort();
    } catch {}
  };
  if (signal) {
    signal.addEventListener("abort", onParentAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        ...(systemInstruction ? { system: systemInstruction } : {}),
        messages: anthropicMessages,
        stream: true,
      }),
      signal: streamAbortController.signal,
    });
  } catch (fetchErr: any) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    console.warn(
      "[GRIOT_DEBUG] Falha no streaming SSE de Anthropic, recorrendo a REST direto:",
      fetchErr,
    );
    return fetchAnthropicDirectSync(params);
  }

  if (!response.ok) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Anthropic Claude retornou erro ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
    );
  }

  let fullText = "";
  const reader = response.body?.getReader();
  if (!reader) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    return fetchAnthropicDirectSync(params);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAnyToken = false;

  let watchdogTimer: any = setTimeout(() => {
    if (!receivedAnyToken && !signal?.aborted) {
      console.warn(
        "[GRIOT_DEBUG] Watchdog acionado: sem tokens Anthropic em 4.5s. Cancelando leitor e recorrendo a REST...",
      );
      try {
        void reader.cancel();
      } catch {}
      try {
        streamAbortController.abort();
      } catch {}
    }
  }, 4500);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Operação cancelada.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") break;

        try {
          const payload = JSON.parse(dataStr);
          if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
            const tok = payload.delta.text || "";
            if (tok) {
              if (!receivedAnyToken) {
                receivedAnyToken = true;
                if (watchdogTimer) {
                  clearTimeout(watchdogTimer);
                  watchdogTimer = null;
                }
              }
              fullText += tok;
              callbacks?.onToken?.(tok);
            }
          }
        } catch {}
      }
    }
  } catch (streamErr: any) {
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada.", "AbortError");
    }
    if (!fullText.trim()) {
      console.warn(
        "[GRIOT_DEBUG] Stream SSE Anthropic interrompido, recorrendo ao endpoint REST padrão:",
        streamErr,
      );
      return fetchAnthropicDirectSync(params);
    }
  } finally {
    clearTimeout(overallTimeoutTimer);
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (signal) signal.removeEventListener("abort", onParentAbort);
    try {
      void reader.cancel();
    } catch {}
  }

  if (!fullText.trim() && !signal?.aborted) {
    return fetchAnthropicDirectSync(params);
  }

  return { text: fullText, toolCalls: [] };
}

/** Fallback para o Supabase Edge Function se nenhuma chave local foi encontrada */
async function streamSupabaseOrchestratorFallback(params: {
  provider: string;
  modelName: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { provider, modelName, messages, systemInstruction, callbacks, signal } = params;

  // Em ambiente móvel nativo Capacitor, não chamar /api/chat se não houver servidor local
  const isCapacitorOrNative =
    typeof window !== "undefined" &&
    (window.location.protocol === "capacitor:" ||
      Boolean((window as any).Capacitor?.isNativePlatform?.()));

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  // 1. Tentar endpoint /api/chat SOMENTE se NÃO for Capacitor nativo
  if (typeof window !== "undefined" && !isCapacitorOrNative) {
    const { signal: chatSignal, cleanup: cleanupChat } = createSafeTimeoutSignal(45000, signal);
    try {
      const localChatRes = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: messages.slice(-20),
          model: modelName,
          systemInstruction,
        }),
        signal: chatSignal,
      });

      if (localChatRes.ok && localChatRes.body) {
        const reader = localChatRes.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let lineBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.t === "text" && parsed.d) {
                fullText += parsed.d;
                callbacks?.onToken?.(parsed.d);
              }
            } catch {
              fullText += trimmed;
              callbacks?.onToken?.(trimmed);
            }
          }
        }

        if (fullText.trim()) {
          return { text: fullText, reasoning: "", toolCalls: [] };
        }
      }
    } catch {
      // continua para Supabase Edge Function
    } finally {
      cleanupChat();
    }
  }

  // 2. Se não há token de sessão, orienta o utilizador a adicionar a sua chave
  if (!token) {
    throw new Error(
      `Sem chave de API configurada para ${provider.toUpperCase()}. Adiciona a tua chave gratuita da Google Gemini em Definições → Chave Google Gemini para conversar em tempo real.`,
    );
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUserMsg?.content || "";

  // Timeout estrito de 12 segundos para chamada remota
  const { signal: edgeSignal, cleanup: cleanupEdge } = createSafeTimeoutSignal(12000, signal);

  let response: Response;
  try {
    response = await fetch(`${GRIOT_SUPABASE_URL}/functions/v1/griot-orchestrator/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: GRIOT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        prompt,
        messages: messages.slice(-20),
        provider,
        model: modelName,
      }),
      signal: edgeSignal,
    });
  } finally {
    cleanupEdge();
  }

  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    const msg =
      errObj.error ||
      `Sem resposta do modelo. Adiciona a tua chave de API em Definições → Chave Google Gemini para conversar diretamente sem restrições.`;
    throw new Error(msg);
  }

  const payload = await response.json();
  const text = payload.result?.content || "";

  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (!word) continue;
    callbacks?.onToken?.(word);
    await new Promise((r) => setTimeout(r, 8));
  }

  return { text, reasoning: "", toolCalls: [] };
}

function mapFunctionNameToActionType(name: string): GriotActionType {
  switch (name) {
    case "shell_exec":
      return "shell.exec";
    case "fs_read_file":
      return "fs.read_file";
    case "fs_write_file":
      return "fs.write_file";
    case "fs_read_tree":
      return "fs.read_tree";
    case "test_run":
      return "test.run";
    default:
      return "shell.exec";
  }
}
