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
          { type: (v as { type: string }).type.toLowerCase(), description: (v as { description: string }).description },
        ]),
      ),
      required: t.parameters.required || [],
    },
  },
}));



import { findApiByIdOrProvider, getUserSavedApis } from "@/lib/user-apis";

/** Procura chave guardada localmente */
export function getSavedApiKey(provider: string): string | null {
  if (typeof window === "undefined") return null;

  // 1. Tenta encontrar nas APIs do utilizador
  const saved = findApiByIdOrProvider(provider);
  if (saved?.apiKey) return saved.apiKey;

  // 2. Chaves legadas
  const keysToTry = [
    `griot_api_key_${provider}`,
    `griot_${provider}_api_key`,
  ];

  for (const k of keysToTry) {
    const val = localStorage.getItem(k)?.trim();
    if (val && val.length > 5) return val;
  }

  // Fallback: se o utilizador tem alguma chave guardada, tenta Gemini como default
  const geminiAny =
    localStorage.getItem("griot_api_key_gemini")?.trim() ||
    localStorage.getItem("griot_gemini_api_key")?.trim();
  if (geminiAny && geminiAny.length > 5) return geminiAny;

  return null;
}

/** Mapeia nomes amigáveis para endpoints de IA */
export function resolveProviderAndModel(modelId: string): { provider: string; modelName: string; specificApiKey?: string } {
  // Se for um ID de API adicionada pelo utilizador
  const userApi = findApiByIdOrProvider(modelId);
  if (userApi) {
    const prov = userApi.providerId;
    let mName = "gemini-2.0-flash";
    if (prov === "openai") mName = "gpt-4o";
    else if (prov === "claude" || prov === "anthropic") mName = "claude-3-5-sonnet-latest";
    else if (prov === "deepseek") mName = "deepseek-chat";
    else if (prov === "groq") mName = "llama-3.3-70b-versatile";
    return { provider: prov, modelName: userApi.model || mName, specificApiKey: userApi.apiKey };
  }

  const m = modelId.toLowerCase();
  if (m.includes("gemini") || m === "modelos" || m === "model-os") {
    const name = m.includes("1.5-pro")
      ? "gemini-1.5-pro"
      : m.includes("1.5-flash")
      ? "gemini-1.5-flash"
      : m.includes("2.5-pro")
      ? "gemini-2.5-pro"
      : m.includes("2.5-flash")
      ? "gemini-2.5-flash"
      : m.includes("3.6-flash")
      ? "gemini-3.6-flash"
      : "gemini-2.0-flash";
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
  return { provider: "gemini", modelName: "gemini-2.0-flash" };
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
  const { modelId, messages, systemInstruction, callbacks, signal } = params;
  const { provider, modelName, specificApiKey } = resolveProviderAndModel(modelId);
  const directKey = specificApiKey || getSavedApiKey(provider);

  // 1. Chamada direta ao Google Gemini
  if (provider === "gemini" && directKey) {
    return streamGeminiDirect({
      apiKey: directKey,
      modelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 2. Chamada direta ao OpenAI
  if (provider === "openai" && directKey) {
    return streamOpenAIDirect({
      apiKey: directKey,
      baseUrl: "https://api.openai.com/v1",
      modelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 3. Chamada direta ao Groq
  if (provider === "groq" && directKey) {
    return streamOpenAIDirect({
      apiKey: directKey,
      baseUrl: "https://api.groq.com/openai/v1",
      modelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 4. Chamada direta ao DeepSeek
  if (provider === "deepseek" && directKey) {
    return streamOpenAIDirect({
      apiKey: directKey,
      baseUrl: "https://api.deepseek.com",
      modelName,
      messages,
      systemInstruction,
      callbacks,
      signal,
    });
  }

  // 5. Fallback para Supabase Edge Function se autenticado
  return streamSupabaseOrchestratorFallback({
    provider,
    modelName,
    messages,
    callbacks,
    signal,
  });
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

  // Converte mensagens para o formato do Gemini
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
    tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");

    // 1. Auto-recuperação inteligente se a Google sugerir um novo modelo no erro 404
    // Ex: "Please update your code to use models/gemini-3.6-flash"
    const updateMatch = errorText.match(/use models\/([a-zA-Z0-9.-]+)/i) || errorText.match(/models\/([a-zA-Z0-9.-]+)/g);
    let suggestedModel: string | null = null;
    if (updateMatch) {
      if (typeof updateMatch[1] === "string" && updateMatch[1] !== modelName) {
        suggestedModel = updateMatch[1];
      } else if (Array.isArray(updateMatch)) {
        for (const m of updateMatch) {
          const clean = m.replace(/^models\//, "");
          if (clean !== modelName) {
            suggestedModel = clean;
            break;
          }
        }
      }
    }

    if (response.status === 404 && suggestedModel && suggestedModel !== modelName) {
      console.warn(`[GRIOT] Google recomendou o modelo ${suggestedModel}. A auto-recuperar...`);
      return streamGeminiDirect({
        ...params,
        modelName: suggestedModel,
      });
    }

    // 2. Fallbacks em cadeia se for 404
    if (response.status === 404) {
      const fallbacks = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.6-flash", "gemini-1.5-pro", "gemini-2.5-flash"];
      for (const candidate of fallbacks) {
        if (candidate !== modelName && candidate !== suggestedModel) {
          try {
            console.warn(`[GRIOT] Tentando modelo alternativo: ${candidate}...`);
            return await streamGeminiDirect({
              ...params,
              modelName: candidate,
            });
          } catch {
            // continua para o próximo fallback
          }
        }
      }
    }

    // 3. Se deu erro 400 por incompatibilidade de ferramentas, tenta sem tools
    if (response.status === 400 && (errorText.includes("tool") || errorText.includes("function"))) {
      const bodyNoTools = { ...body };
      delete bodyNoTools.tools;
      const resNoTools = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyNoTools),
        signal,
      });
      if (resNoTools.ok) {
        response = resNoTools;
      }
    }

    if (!response.ok) {
      throw new Error(
        `Google Gemini retornou erro ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
      );
    }
  }

  let fullText = "";
  let fullReasoning = "";
  const toolCalls: GriotAction[] = [];

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream de resposta indisponível.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

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
              fullText += part.text;
              callbacks?.onToken?.(part.text);
            }
            if (part.thought) {
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
                risk: mappedType.startsWith("fs.write") || mappedType.startsWith("shell.") ? "sensitive" : "safe",
                params: fn.args || {},
                requiresApproval: mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: formattedMessages,
      stream: true,
      tools: OPENAI_TOOLS,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Provedor de IA retornou erro ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
    );
  }

  let fullText = "";
  let fullReasoning = "";
  const toolCalls: GriotAction[] = [];

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream de resposta indisponível.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
          fullText += delta.content;
          callbacks?.onToken?.(delta.content);
        }
        if (delta?.reasoning_content) {
          fullReasoning += delta.reasoning_content;
          callbacks?.onReasoning?.(delta.reasoning_content);
        }
        if (delta?.tool_calls) {
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
                risk: mappedType.startsWith("fs.write") || mappedType.startsWith("shell.") ? "sensitive" : "safe",
                params: parsedArgs,
                requiresApproval: mappedType.startsWith("fs.write") || mappedType.startsWith("shell."),
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

  return { text: fullText, reasoning: fullReasoning, toolCalls };
}

/** Fallback para o Supabase Edge Function se nenhuma chave local foi encontrada */
async function streamSupabaseOrchestratorFallback(params: {
  provider: string;
  modelName: string;
  messages: ChatMessage[];
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}): Promise<AIResponse> {
  const { provider, modelName, messages, callbacks, signal } = params;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error(
      `Sem chave de API configurada para ${provider.toUpperCase()}. Vai a Home → APIs ou Definições → Chave de IA para adicionar a tua chave gratuitamente (ex: Google Gemini).`,
    );
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUserMsg?.content || "";

  const response = await fetch(`${GRIOT_SUPABASE_URL}/functions/v1/griot-orchestrator/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: GRIOT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      prompt,
      provider,
      model: modelName,
    }),
    signal,
  });

  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    const msg =
      errObj.error ||
      `Sem resposta do modelo. Adiciona a tua chave de API em Home → APIs para conversar diretamente sem limites.`;
    throw new Error(msg);
  }

  const payload = await response.json();
  const text = payload.result?.content || "";

  // Simula streaming do resultado em blocos suaves
  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (!word) continue;
    callbacks?.onToken?.(word);
    await new Promise((r) => setTimeout(r, 12));
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
