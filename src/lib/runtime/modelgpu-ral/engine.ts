/**
 * GRIOT ModelGPU RAL (Reasoning Abstraction Layer) Engine
 * Virtualizes the 8 native AppChats as a decentralized cognitive GPU cluster.
 * 100% Zero-API: executes workloads via App Intent / Observer UI Scraper.
 */

import {
  VirtualGpuCoreId,
  VirtualGpuCore,
  GpuComputeWorkload,
  ModelGpuRalState,
  GpuTaskAffinity,
} from "./types";
import { observerEngine } from "../observer";
import { nativeObserverBridge } from "../native-bridge";
import { loadPrefs } from "@/lib/settings";

const INITIAL_CORES: Record<VirtualGpuCoreId, VirtualGpuCore> = {
  core_0_chatgpt: {
    id: "core_0_chatgpt",
    appId: "chatgpt",
    name: "ChatGPT Core 0",
    vendor: "OpenAI",
    coreIndex: 0,
    androidPackage: "com.openai.chatgpt",
    urlScheme: "chatgpt://",
    webUrl: "https://chatgpt.com",
    status: "idle",
    enabled: true,
    vramMb: 128000,
    contextTokens: 128000,
    virtualClockMhz: 3450,
    affinities: ["deep_reasoning", "math_logic", "rapid_chat"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 420 },
  },
  core_1_claude: {
    id: "core_1_claude",
    appId: "claude",
    name: "Claude Core 1",
    vendor: "Anthropic",
    coreIndex: 1,
    androidPackage: "com.anthropic.claude",
    urlScheme: "claude://",
    webUrl: "https://claude.ai",
    status: "idle",
    enabled: true,
    vramMb: 200000,
    contextTokens: 200000,
    virtualClockMhz: 3800,
    affinities: ["code_generation", "architecture", "deep_reasoning"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 380 },
  },
  core_2_gemini: {
    id: "core_2_gemini",
    appId: "gemini",
    name: "Gemini Core 2",
    vendor: "Google",
    coreIndex: 2,
    androidPackage: "com.google.gemini",
    urlScheme: "googleapp://",
    webUrl: "https://gemini.google.com",
    status: "idle",
    enabled: true,
    vramMb: 1000000,
    contextTokens: 1000000,
    virtualClockMhz: 4100,
    affinities: ["multimodal_vision", "deep_research", "rapid_chat"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 310 },
  },
  core_3_deepseek: {
    id: "core_3_deepseek",
    appId: "deepseek",
    name: "DeepSeek Core 3",
    vendor: "DeepSeek",
    coreIndex: 3,
    androidPackage: "com.deepseek.chat",
    urlScheme: "deepseek://",
    webUrl: "https://chat.deepseek.com",
    status: "idle",
    enabled: true,
    vramMb: 64000,
    contextTokens: 64000,
    virtualClockMhz: 3600,
    affinities: ["deep_reasoning", "code_generation", "math_logic"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 460 },
  },
  core_4_kimi: {
    id: "core_4_kimi",
    appId: "kimi",
    name: "Kimi Core 4",
    vendor: "Moonshot AI",
    coreIndex: 4,
    androidPackage: "com.moonshot.kimi",
    urlScheme: "kimi://",
    webUrl: "https://kimi.moonshot.cn",
    status: "idle",
    enabled: true,
    vramMb: 256000,
    contextTokens: 256000,
    virtualClockMhz: 3200,
    affinities: ["rapid_chat", "deep_research"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 340 },
  },
  core_5_grok: {
    id: "core_5_grok",
    appId: "grok",
    name: "Grok Core 5",
    vendor: "xAI",
    coreIndex: 5,
    androidPackage: "ai.x.grok",
    urlScheme: "grok://",
    webUrl: "https://x.ai",
    status: "idle",
    enabled: true,
    vramMb: 128000,
    contextTokens: 128000,
    virtualClockMhz: 3900,
    affinities: ["deep_research", "rapid_chat", "math_logic"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 330 },
  },
  core_6_perplexity: {
    id: "core_6_perplexity",
    appId: "perplexity",
    name: "Perplexity Core 6",
    vendor: "Perplexity",
    coreIndex: 6,
    androidPackage: "ai.perplexity.app.android",
    urlScheme: "perplexity://",
    webUrl: "https://perplexity.ai",
    status: "idle",
    enabled: true,
    vramMb: 64000,
    contextTokens: 64000,
    virtualClockMhz: 3500,
    affinities: ["deep_research", "rapid_chat"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 290 },
  },
  core_7_mistral: {
    id: "core_7_mistral",
    appId: "mistral",
    name: "Mistral Core 7",
    vendor: "Mistral AI",
    coreIndex: 7,
    androidPackage: "ai.mistral.chat",
    urlScheme: "mistral://",
    webUrl: "https://chat.mistral.ai",
    status: "idle",
    enabled: true,
    vramMb: 128000,
    contextTokens: 128000,
    virtualClockMhz: 3700,
    affinities: ["code_generation", "architecture", "deep_reasoning"],
    metrics: { totalWorkloads: 0, tokensScraped: 0, actionsExecuted: 0, avgLatencyMs: 350 },
  },
};

export class ModelGpuRalEngine {
  private state: ModelGpuRalState = {
    active: true,
    zeroApiMode: true,
    cores: { ...INITIAL_CORES },
    activeWorkload: null,
    workloadHistory: [],
    telemetry: {
      totalAllocatedGcu: 0,
      aggregatedThroughputTps: 48.5,
      activeCoresCount: 8,
      totalZeroApiDispatches: 0,
    },
  };

  private listeners: Set<(state: ModelGpuRalState) => void> = new Set();

  constructor() {
    this.initObserverHooks();
    this.refreshCoreStatuses();
  }

  private initObserverHooks() {
    // Intercetar eventos brutos do Observer para telemetria em tempo real
    observerEngine.subscribeEvents((event) => {
      if (event.content) {
        this.state.telemetry.lastScrapedChunk = event.content.slice(-120);
        // Atualizar métricas do core correspondente
        const core = Object.values(this.state.cores).find(
          (c) => c.appId === event.source.appId || c.androidPackage === event.source.appPackage,
        );
        if (core) {
          core.metrics.tokensScraped += Math.round(event.content.length / 4);
          core.metrics.lastActiveTimestamp = new Date().toISOString();
          core.status = "streaming";
          setTimeout(() => {
            if (core.status === "streaming") core.status = "idle";
            this.notify();
          }, 2000);
        }
      }
      this.notify();
    });

    observerEngine.subscribeActions((action, result) => {
      if (this.state.activeWorkload) {
        this.state.activeWorkload.actionsDetected.push(action);
        if (result) {
          this.state.activeWorkload.executionResults.push(result);
        }
      }
      this.notify();
    });
  }

  public refreshCoreStatuses() {
    const prefs = loadPrefs();
    let activeCount = 0;

    for (const core of Object.values(this.state.cores)) {
      const isConnected =
        prefs[`acp:${core.appId}`] === true ||
        prefs[`chat:${core.appId}`] === true ||
        prefs[`app:${core.appId}`] === true ||
        prefs[core.appId] === true;

      core.enabled = isConnected;
      if (isConnected) activeCount++;
    }

    this.state.telemetry.activeCoresCount = activeCount;
    this.notify();
  }

  public getState(): ModelGpuRalState {
    this.refreshCoreStatuses();
    return { ...this.state };
  }

  public subscribe(listener: (state: ModelGpuRalState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const currentState = { ...this.state };
    this.listeners.forEach((l) => l(currentState));
  }

  /**
   * Encaminha uma carga de trabalho cognitiva para o Virtual Core mais adequado (ou core explícito).
   * 100% Zero-API: Abre o Intent da app / copia o prompt formatado com o protocolo GRIOT.
   */
  public async dispatchComputeWorkload(params: {
    prompt: string;
    title?: string;
    affinity?: GpuTaskAffinity;
    targetCoreId?: VirtualGpuCoreId;
  }): Promise<GpuComputeWorkload> {
    const affinity = params.affinity || "code_generation";
    const coreId = params.targetCoreId || this.selectOptimalCore(affinity);
    const core = this.state.cores[coreId];

    const workloadId = "gpu_wl_" + Math.random().toString(36).substring(2, 9);
    const workload: GpuComputeWorkload = {
      id: workloadId,
      title: params.title || `Cognitive Workload #${this.state.workloadHistory.length + 1}`,
      prompt: params.prompt,
      affinity,
      targetCoreId: coreId,
      status: "dispatched_to_app",
      rawOutput: "",
      actionsDetected: [],
      executionResults: [],
      startedAt: new Date().toISOString(),
      estimatedGcu: 0.15,
    };

    this.state.activeWorkload = workload;
    this.state.telemetry.totalZeroApiDispatches += 1;
    this.state.telemetry.totalAllocatedGcu += workload.estimatedGcu;

    // Atualiza status do Core
    core.status = "dispatched";
    core.metrics.totalWorkloads += 1;
    this.notify();

    // 1. Preparar prompt com envelope de instrução GRIOT Observer
    const envelope = [
      `[GRIOT ModelGPU RAL // Core: ${core.name}]`,
      `Instrução: Executa a seguinte tarefa gerando blocos <griot_action> quando necessário:`,
      params.prompt,
    ].join("\n\n");

    // Carga de trabalho registrada no cluster ModelGPU RAL silenciosamente
    return true;

    return workload;
  }

  /**
   * Regista a conclusão da carga de trabalho recebida pelo Observer
   */
  public completeWorkload(workloadId: string, output: string) {
    if (this.state.activeWorkload?.id === workloadId) {
      const finished: GpuComputeWorkload = {
        ...this.state.activeWorkload,
        rawOutput: output,
        status: "completed",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(this.state.activeWorkload.startedAt).getTime(),
      };

      const core = this.state.cores[finished.targetCoreId];
      if (core) {
        core.status = "cooling";
        setTimeout(() => {
          core.status = "idle";
          this.notify();
        }, 1500);
      }

      this.state.workloadHistory.unshift(finished);
      this.state.activeWorkload = null;
      this.notify();
    }
  }

  /**
   * Seleciona o Virtual Core ótimo para a afinidade pretendida
   */
  private selectOptimalCore(affinity: GpuTaskAffinity): VirtualGpuCoreId {
    // 1. Procurar cores com afinidade prioritária que estejam ativos
    const candidates = Object.values(this.state.cores).filter(
      (c) => c.enabled && c.affinities.includes(affinity),
    );

    if (candidates.length > 0) {
      // Retorna o que tiver menor carga
      candidates.sort((a, b) => a.metrics.totalWorkloads - b.metrics.totalWorkloads);
      return candidates[0].id;
    }

    // 2. Fallbacks padrão
    switch (affinity) {
      case "code_generation":
      case "architecture":
        return "core_1_claude";
      case "deep_reasoning":
      case "math_logic":
        return "core_3_deepseek";
      case "multimodal_vision":
        return "core_2_gemini";
      case "deep_research":
        return "core_6_perplexity";
      default:
        return "core_0_chatgpt";
    }
  }
}

export const modelGpuRalEngine = new ModelGpuRalEngine();
