/**
 * GRIOT Observer Native Bridge (Capacitor / Android Bridge)
 * Interface entre a camada de Acessibilidade do Android (GriotObserverService)
 * e o motor de eventos ReAct do frontend/runtime.
 *
 * Em APK Nativo: Comunica com o serviço de acessibilidade via BroadcastReceiver / Plugin nativo.
 * Em Web/Preview: Emite eventos locais de interface simulando o pipeline nativo de UI scraping.
 */

import { observerEngine } from "./observer";
import { ObserverSource } from "./protocol";
import { getObserverSourceForApp } from "./apps";
import { loadPrefs } from "@/lib/settings";

export interface AccessibilityPermissionStatus {
  serviceEnabled: boolean;
  notificationListenerEnabled: boolean;
  monitoredPackages: string[];
}

export class GriotNativeObserverBridge {
  private static instance: GriotNativeObserverBridge;

  private isServiceActive: boolean = false;
  private isNotifActive: boolean = false;

  private constructor() {
    this.initListeners();
  }

  public static getInstance(): GriotNativeObserverBridge {
    if (!GriotNativeObserverBridge.instance) {
      GriotNativeObserverBridge.instance = new GriotNativeObserverBridge();
    }
    return GriotNativeObserverBridge.instance;
  }

  private initListeners() {
    if (typeof window === "undefined") return;

    // Escutar eventos do plugin nativo Capacitor se disponível
    if ((window as any).Capacitor?.isNativePlatform?.()) {
      (window as any).Capacitor?.Plugins?.GriotObserverPlugin?.addListener(
        "onObserverEvent",
        (data: { package: string; content: string; appName: string }) => {
          window.dispatchEvent(new CustomEvent("griot:native-accessibility-event", { detail: data }));
        },
      );

      (window as any).Capacitor?.Plugins?.GriotObserverPlugin?.addListener(
        "onAppAutomationResult",
        (data: { package: string; threadTitle: string; success: boolean; message: string }) => {
          window.dispatchEvent(new CustomEvent("griot:app-automation-result", { detail: data }));
        },
      );

      (window as any).Capacitor?.Plugins?.GriotObserverPlugin?.addListener(
        "onAppStreamChunk",
        (data: { threadTitle: string; text: string; isDone: boolean }) => {
          window.dispatchEvent(new CustomEvent("griot:app-stream-chunk", { detail: data }));
        },
      );
    }

    // Escutar eventos CustomEvent locais
    window.addEventListener("griot:native-accessibility-event", (e: any) => {
      const detail = e.detail;
      if (detail?.package && detail?.content) {
        if (/<griot_action\b|```griot[:\n]|\[GRIOT:/.test(detail.content)) {
          this.handleNativeScrapedContent(
            detail.package,
            detail.content,
            detail.appName || detail.package,
          );
        }
      }
    });

    // Ler estado das permissões guardadas
    const prefs = loadPrefs();
    this.isServiceActive = prefs["observer:accessibility_enabled"] === true;
    this.isNotifActive = prefs["observer:notifications_enabled"] === true;
  }

  /**
   * Abre o ecrã de Definições de Acessibilidade do Android para o utilizador ativar o GriotObserverService
   */
  public async requestAccessibilityPermission(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if ((window as any).Capacitor?.isNativePlatform?.()) {
      try {
        await (window as any).Capacitor?.Plugins?.GriotObserverPlugin?.openAccessibilitySettings();
        return true;
      } catch (err) {
        console.warn("Falha ao abrir definições nativas:", err);
      }
    }

    // Em web/PWA ou fallback: simula ativação da permissão com flag local
    this.isServiceActive = !this.isServiceActive;
    const prefs = loadPrefs();
    prefs["observer:accessibility_enabled"] = this.isServiceActive;
    window.localStorage.setItem("griot_user_prefs", JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("griot:prefs-changed", { detail: prefs }));
    return this.isServiceActive;
  }

  public async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if ((window as any).Capacitor?.isNativePlatform?.()) {
      try {
        await (
          window as any
        ).Capacitor?.Plugins?.GriotObserverPlugin?.openNotificationListenerSettings();
        return true;
      } catch (err) {
        console.warn("Falha ao abrir definições nativas de notificação:", err);
      }
    }

    this.isNotifActive = !this.isNotifActive;
    const prefs = loadPrefs();
    prefs["observer:notifications_enabled"] = this.isNotifActive;
    window.localStorage.setItem("griot_user_prefs", JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("griot:prefs-changed", { detail: prefs }));
    return this.isNotifActive;
  }

  public async syncRealDeviceStatus(): Promise<AccessibilityPermissionStatus> {
    if (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.GriotObserverPlugin;
        if (plugin?.checkPermissionsStatus) {
          const res = await plugin.checkPermissionsStatus();
          if (res) {
            this.isServiceActive = res.accessibility === true;
            this.isNotifActive = res.notificationListener === true;
            const prefs = loadPrefs();
            prefs["observer:accessibility_enabled"] = this.isServiceActive;
            prefs["observer:notifications_enabled"] = this.isNotifActive;
            window.localStorage.setItem("griot_user_prefs", JSON.stringify(prefs));
            window.dispatchEvent(new CustomEvent("griot:prefs-changed", { detail: prefs }));
          }
        }
      } catch (err) {
        console.warn("Erro ao sincronizar status real do dispositivo:", err);
      }
    }
    return this.getStatus();
  }

  public getStatus(): AccessibilityPermissionStatus {
    const prefs = loadPrefs();
    return {
      serviceEnabled: prefs["observer:accessibility_enabled"] === true,
      notificationListenerEnabled: prefs["observer:notifications_enabled"] === true,
      monitoredPackages: [
        "com.openai.chatgpt",
        "com.anthropic.claude",
        "com.google.gemini",
        "com.deepseek.chat",
        "com.moonshot.kimi",
        "ai.x.grok",
        "ai.perplexity.app.android",
        "ai.mistral.chat",
      ],
    };
  }

  /**
   * Envia comando/prompt para a app externa de IA de forma invisível via Acessibilidade
   */
  public async sendAppMessage(
    pkg: string,
    threadTitle: string,
    message: string,
  ): Promise<{ success: boolean; injected: boolean }> {
    if (typeof window === "undefined") return { success: false, injected: false };

    if ((window as any).Capacitor?.isNativePlatform?.()) {
      try {
        const res = await (window as any).Capacitor?.Plugins?.GriotObserverPlugin?.sendAppMessage({
          package: pkg,
          threadTitle,
          message,
        });
        return {
          success: res?.success === true,
          injected: res?.injected === true,
        };
      } catch (err) {
        console.warn("Falha ao injetar mensagem via plugin nativo:", err);
      }
    }

    return { success: false, injected: false };
  }

  /** Aguarda uma fotografia estável da UI da app alvo depois da injeção. */
  public waitForAppResponse(
    pkg: string,
    prompt: string,
    timeoutMs = 60_000,
  ): Promise<{ text: string; package: string }> {
    if (typeof window === "undefined") return Promise.reject(new Error("Window indisponível."));

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      const promptNorm = normalize(prompt);
      let lastCandidate = "";
      let stableCount = 0;

      const cleanup = () => {
        window.removeEventListener("griot:native-accessibility-event", onEvent as EventListener);
        window.clearTimeout(timeout);
      };

      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("A app externa não devolveu uma resposta dentro do tempo limite."));
      }, timeoutMs);

      const onEvent = (event: Event) => {
        const detail = (event as CustomEvent).detail as { package?: string; content?: string };
        if (detail?.package !== pkg || typeof detail.content !== "string") return;

        let candidate = detail.content.trim();
        if (!candidate) return;

        // Never expose our own injected prompt as an assistant answer.
        if (promptNorm) {
          candidate = candidate.replace(prompt, "").trim();
        }
        if (!candidate) return;

        const clean = normalize(candidate);
        if (clean === lastCandidate) stableCount += 1;
        else { lastCandidate = clean; stableCount = 1; }

        // Two identical snapshots indicate a stable UI state rather than a streaming frame.
        if (stableCount >= 2) {
          cleanup();
          resolve({ text: candidate, package: pkg });
        }
      };

      window.addEventListener("griot:native-accessibility-event", onEvent as EventListener);
    });
  }

  /**
   * Processa texto capturado da UI de qualquer uma das 8 apps
   */
  public handleNativeScrapedContent(pkg: string, content: string, appName: string) {
    const appId = this.resolveAppIdFromPackage(pkg);
    const source: ObserverSource = {
      ...getObserverSourceForApp(appId),
      appPackage: pkg,
      sessionTitle: appName,
    };

    void observerEngine.processIncomingAIMessage(source, content, `scraped_${appId}`);
  }

  private resolveAppIdFromPackage(pkg: string): string {
    if (pkg.includes("openai") || pkg.includes("chatgpt")) return "chatgpt";
    if (pkg.includes("anthropic") || pkg.includes("claude")) return "claude";
    if (pkg.includes("google") || pkg.includes("gemini") || pkg.includes("bard")) return "gemini";
    if (pkg.includes("deepseek")) return "deepseek";
    if (pkg.includes("moonshot") || pkg.includes("kimi")) return "kimi";
    if (pkg.includes("grok") || pkg.includes("ai.x")) return "grok";
    if (pkg.includes("perplexity")) return "perplexity";
    if (pkg.includes("mistral")) return "mistral";
    return "custom";
  }
}

export const nativeObserverBridge = GriotNativeObserverBridge.getInstance();
