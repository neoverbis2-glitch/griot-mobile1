/**
 * GRIOT Observer Apps Definition & Adapters
 * Specifications, schemas, command instructions and event adaptors for the 8 AI Chat Mobile Apps:
 * 1. ChatGPT (OpenAI)
 * 2. Claude (Anthropic)
 * 3. Gemini (Google)
 * 4. DeepSeek (DeepSeek)
 * 5. Kimi (Moonshot AI)
 * 6. Grok (xAI)
 * 7. Perplexity (Perplexity)
 * 8. Le Chat (Mistral AI)
 */

import { ObserverSource } from "./protocol";

export interface AiChatAppConfig {
  id: string;
  name: string;
  short: string;
  vendor: string;
  androidPackage: string;
  iosUrlScheme: string;
  webUrl: string;
  defaultModel: string;
  supportedModels: string[];
  capabilities: {
    multimodal: boolean;
    streaming: boolean;
    systemPrompt: boolean;
    toolCalling: boolean;
    liveVoice: boolean;
    codeInterpreter: boolean;
  };
  /** System prompt snippet injected to teach this AI how to invoke the GRIOT Runtime */
  runtimeInstruction: string;
}

export const AI_OBSERVER_APPS: Record<string, AiChatAppConfig> = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    short: "GPT",
    vendor: "OpenAI",
    androidPackage: "com.openai.chatgpt",
    iosUrlScheme: "chatgpt://",
    webUrl: "https://chatgpt.com",
    defaultModel: "gpt-4o",
    supportedModels: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: true,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - OpenAI Adapter]
You are connected to the GRIOT Mobile Observer Engine. You can inspect project files, execute terminal tasks, and run tests by wrapping commands in <griot_action type="action_type">...</griot_action> or \`\`\`griot:action blocks.`,
  },
  claude: {
    id: "claude",
    name: "Claude",
    short: "CL",
    vendor: "Anthropic",
    androidPackage: "com.anthropic.claude",
    iosUrlScheme: "claude://",
    webUrl: "https://claude.ai",
    defaultModel: "claude-3-7-sonnet-20250219",
    supportedModels: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: false,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - Anthropic Claude Adapter]
You are connected to the GRIOT Mobile Observer Engine. When requesting code changes, diffs, terminal commands or file trees, output them formatted as GRIOT action blocks (<griot_action type="...">...</griot_action>).`,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    short: "GE",
    vendor: "Google",
    androidPackage: "com.google.gemini",
    iosUrlScheme: "googleapp://",
    webUrl: "https://gemini.google.com",
    defaultModel: "gemini-3.7-flash",
    supportedModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: true,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - Google Gemini Adapter]
You are connected to the GRIOT Mobile Observer Engine. You have access to the local project workspace and command dispatcher via <griot_action type="shell.exec">...</griot_action> and <griot_action type="fs.write_file">...</griot_action>.`,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    short: "DS",
    vendor: "DeepSeek",
    androidPackage: "com.deepseek.chat",
    iosUrlScheme: "deepseek://",
    webUrl: "https://chat.deepseek.com",
    defaultModel: "deepseek-r1",
    supportedModels: ["deepseek-r1", "deepseek-v3"],
    capabilities: {
      multimodal: false,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: false,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - DeepSeek Reasoner Adapter]
DeepSeek R1 / V3 reasoning engine connected to GRIOT Observer. Output code modifications, git commands, and tests using standard \`\`\`griot:shell or \`\`\`griot:write syntax.`,
  },
  kimi: {
    id: "kimi",
    name: "Kimi",
    short: "KM",
    vendor: "Moonshot AI",
    androidPackage: "com.moonshot.kimi",
    iosUrlScheme: "kimi://",
    webUrl: "https://kimi.moonshot.cn",
    defaultModel: "kimi-k1.5",
    supportedModels: ["kimi-k1.5", "moonshot-v1-128k"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: false,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - Moonshot Kimi Adapter]
Long-context Kimi agent connected to GRIOT Observer. You can manage project workspaces via <griot_action type="..."> tags.`,
  },
  grok: {
    id: "grok",
    name: "Grok",
    short: "GR",
    vendor: "xAI",
    androidPackage: "ai.x.grok",
    iosUrlScheme: "grok://",
    webUrl: "https://grok.com",
    defaultModel: "grok-3",
    supportedModels: ["grok-3", "grok-3-mini", "grok-2"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: true,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - xAI Grok Adapter]
Real-time Grok 3 agent connected to GRIOT Mobile. Dispatch workspace commands with <griot_action type="shell.exec">...</griot_action>.`,
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    short: "PX",
    vendor: "Perplexity",
    androidPackage: "ai.perplexity.app.android",
    iosUrlScheme: "perplexity://",
    webUrl: "https://www.perplexity.ai",
    defaultModel: "sonar-pro",
    supportedModels: ["sonar-pro", "sonar-reasoning-pro", "sonar"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: false,
      codeInterpreter: false,
    },
    runtimeInstruction: `[GRIOT Observer Integration - Perplexity Sonar Adapter]
Perplexity search & research agent connected to GRIOT Observer. Return cited solutions and dispatch workspace actions using GRIOT action tags.`,
  },
  mistral: {
    id: "mistral",
    name: "Le Chat",
    short: "LC",
    vendor: "Mistral AI",
    androidPackage: "ai.mistral.chat",
    iosUrlScheme: "mistral://",
    webUrl: "https://chat.mistral.ai",
    defaultModel: "mistral-large-2411",
    supportedModels: ["mistral-large-2411", "mistral-small", "codestral-2501"],
    capabilities: {
      multimodal: true,
      streaming: true,
      systemPrompt: true,
      toolCalling: true,
      liveVoice: false,
      codeInterpreter: true,
    },
    runtimeInstruction: `[GRIOT Observer Integration - Mistral Le Chat Adapter]
Mistral Large & Codestral connected to GRIOT Observer. Dispatch code modifications and commands using <griot_action> blocks.`,
  },
};

/** Retorna a fonte do observador padronizada para uma dada app */
export function getObserverSourceForApp(appId: string): ObserverSource {
  const cfg = AI_OBSERVER_APPS[appId];
  if (!cfg) {
    return {
      provider: "custom",
      appPackage: `app.${appId}`,
      sessionTitle: appId,
    };
  }
  return {
    provider: (["chatgpt", "claude", "gemini"].includes(appId) ? appId : "custom") as any,
    appPackage: cfg.androidPackage,
    sessionTitle: cfg.name,
    model: cfg.defaultModel,
  };
}
