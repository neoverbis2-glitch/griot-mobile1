/**
 * GRIOT ReAct Loop Engine
 *
 * Implements the full iterative ReAct cycle:
 * User Prompt -> LLM -> Tool Call / Action -> Execution -> Observation -> LLM -> Final Response.
 * Includes Reflection & Self-healing on tool failures.
 */

import { streamDirectAI, type ChatMessage, type StreamCallbacks } from "@/lib/ai-client";
import { defaultExecutor } from "./executors";
import { parseGriotActions } from "./parser";
import type { GriotAction, GriotExecutionResult } from "./protocol";

export interface ReActExecutionStep {
  stepIndex: number;
  thought?: string;
  action?: GriotAction;
  result?: GriotExecutionResult;
}

export interface ReActLoopResult {
  finalAnswer: string;
  reasoning: string;
  steps: ReActExecutionStep[];
  actionsExecuted: GriotAction[];
}

export interface ReActLoopOptions {
  modelId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  systemInstruction?: string;
  context?: string;
  maxIterations?: number;
  callbacks?: StreamCallbacks & {
    onActionStart?: (action: GriotAction) => void;
    onActionCompleted?: (action: GriotAction, result: GriotExecutionResult) => void;
    onStepChange?: (step: number) => void;
  };
  signal?: AbortSignal;
}

const MAX_DEFAULT_ITERATIONS = 4;

export async function executeReActLoop(options: ReActLoopOptions): Promise<ReActLoopResult> {
  const {
    modelId,
    messages: baseMessages,
    systemInstruction = "És o GRIOT, o assistente de engenharia de software e inteligência artificial de elite. Quando precisares de inspecionar ou modificar ficheiros ou executar comandos, utiliza as ferramentas disponíveis.",
    context,
    maxIterations = MAX_DEFAULT_ITERATIONS,
    callbacks,
    signal,
  } = options;

  const steps: ReActExecutionStep[] = [];
  const actionsExecuted: GriotAction[] = [];
  let currentMessages: ChatMessage[] = baseMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (context) {
    currentMessages.unshift({
      role: "system",
      content: `[CONTEXTO DO PROJETO GRIOT]\n${context}`,
    });
  }

  let finalAnswer = "";
  let fullReasoning = "";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    callbacks?.onStepChange?.(iteration);

    let iterationText = "";
    let iterationReasoning = "";

    const response = await streamDirectAI({
      modelId,
      messages: currentMessages,
      systemInstruction,
      callbacks: {
        onToken: (token) => {
          iterationText += token;
          callbacks?.onToken?.(token);
        },
        onReasoning: (r) => {
          iterationReasoning += r;
          callbacks?.onReasoning?.(r);
        },
        onStep: () => callbacks?.onStep?.(),
      },
      signal,
    });

    const candidateActions: GriotAction[] = [...response.toolCalls];

    // Se o modelo gerou blocos de ação em XML / Markdown mas não via tool call nativo
    const parsedFromText = parseGriotActions(response.text);
    for (const pa of parsedFromText) {
      if (!candidateActions.some((ca) => ca.type === pa.type && JSON.stringify(ca.params) === JSON.stringify(pa.params))) {
        candidateActions.push(pa);
      }
    }

    fullReasoning += iterationReasoning;

    // Se não há ferramentas a executar, chegámos à resposta final
    if (candidateActions.length === 0) {
      finalAnswer = response.text;
      break;
    }

    // Executa as ações detetadas
    const stepRecord: ReActExecutionStep = {
      stepIndex: iteration,
      thought: iterationReasoning || undefined,
    };

    let observationText = "";

    for (const action of candidateActions) {
      callbacks?.onActionStart?.(action);
      actionsExecuted.push(action);

      let result: GriotExecutionResult;
      try {
        result = await defaultExecutor.execute(action);
      } catch (execErr) {
        result = {
          actionId: action.id,
          actionType: action.type,
          status: "failed",
          exitCode: 1,
          stdout: "",
          stderr: execErr instanceof Error ? execErr.message : String(execErr),
          durationMs: 0,
          timestamp: new Date().toISOString(),
        };
      }

      callbacks?.onActionCompleted?.(action, result);
      stepRecord.action = action;
      stepRecord.result = result;

      // Formata a observação para auto-correção / reflexão da IA
      const formattedFeedback = defaultExecutor.formatFeedbackForAI(result);
      observationText += `\n${formattedFeedback}\n`;

      if (result.status === "failed" || result.exitCode !== 0) {
        observationText += `[Aviso de Auto-Correção]: A ação ${action.type} falhou com código ${result.exitCode}. Analisa o erro em STDERR acima e formula uma alternativa ou correção.\n`;
      }
    }

    steps.push(stepRecord);

    // Alimenta o loop ReAct adicionando a resposta do assistente e a observação
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.text || "[Executando ferramenta...]" },
      { role: "user", content: `[OBSERVAÇÃO DA EXECUÇÃO]\n${observationText}\nPor favor analisa os resultados e conclui a resposta.` },
    ];
  }

  return {
    finalAnswer: finalAnswer || "Execução concluída.",
    reasoning: fullReasoning,
    steps,
    actionsExecuted,
  };
}
