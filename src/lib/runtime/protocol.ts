/**
 * GRIOT Runtime Protocol
 * Event Bus, Action Schemas and Execution Types for Agent <-> GRIOT Interoperability
 */

export type AIProvider =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "grok"
  | "perplexity"
  | "mistral"
  | "custom"
  | "local";

export type ObserverSource = {
  provider: AIProvider;
  model?: string;
  appPackage?: string;
  sessionTitle?: string;
  appId?: string;
  vendor?: string;
  connected?: boolean;
};

export type ObserverEventType =
  | "ai.response.started"
  | "ai.response.delta"
  | "ai.response.completed"
  | "ai.message.detected"
  | "observer.connected"
  | "observer.disconnected"
  | "observer.status_changed"
  | "command.dispatched"
  | "command.completed"
  | "command.failed";

export type ObserverEvent = {
  id: string;
  type: ObserverEventType;
  source: ObserverSource;
  sessionId: string;
  timestamp: string;
  content?: string;
  delta?: string;
  metadata?: Record<string, unknown>;
};

export type GriotActionCategory = "fs" | "git" | "shell" | "test";

export type GriotActionType =
  // File System
  | "fs.read_tree"
  | "fs.read_file"
  | "fs.write_file"
  | "fs.patch"
  | "fs.delete_file"
  // Git
  | "git.status"
  | "git.diff"
  | "git.checkout"
  | "git.commit"
  | "git.push"
  | "git.log"
  // Terminal / Shell
  | "shell.exec"
  | "shell.install"
  | "shell.build"
  | "shell.status"
  // Test Runner
  | "test.run"
  | "test.verify"
  | "test.coverage";

export type RiskLevel = "safe" | "sensitive" | "dangerous";

export type GriotAction = {
  id: string;
  type: GriotActionType;
  category: GriotActionCategory;
  risk: RiskLevel;
  params: Record<string, unknown>;
  rawBlock?: string;
  requiresApproval: boolean;
  approved?: boolean;
  status: "pending" | "approved" | "rejected" | "executing" | "success" | "failed";
  createdAt: string;
};

export type GriotExecutionResult = {
  actionId: string;
  actionType: GriotActionType;
  status: "success" | "failed" | "rejected";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  data?: Record<string, unknown>;
  diff?: string;
  timestamp: string;
};

export type ObserverState = {
  active: boolean;
  connectedApps: ObserverSource[];
  activeSessionId?: string;
  lastEvent?: ObserverEvent;
  pendingActions: GriotAction[];
  executionHistory: GriotExecutionResult[];
};
