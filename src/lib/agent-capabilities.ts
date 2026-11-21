import { supabase } from "@/integrations/supabase/client";

export type GriotRegisteredAgent = { id: string; name: string; created_at: string };
export type PitchDeckCapability = { capabilityId: "pitch_deck.generate"; enabled: boolean };
export type AgentPitchDeck = {
  id: string;
  filename: string;
  presentation_json: {
    title: string;
    subtitle?: string;
    audience?: string;
    slides: Array<{
      title: string;
      bullets: string[];
      evidence: "verified" | "estimate" | "hypothesis" | "unspecified";
      metrics: Array<{ label: string; value: string }>;
    }>;
  };
  created_at: string;
};
export type AgentDeckDetail = {
  artifactId: string;
  fileName: string;
  presentation: AgentPitchDeck["presentation_json"];
  signedUrl: string;
  expiresInSeconds: number;
};

async function projectWorkspaceId(projectId: string): Promise<string> {
  const { data, error } = await (supabase as any)
    .from("griot_studio_projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.workspace_id) {
    throw new Error("Não foi possível verificar o espaço de trabalho do projeto.");
  }
  return String(data.workspace_id);
}

async function orchestrator<T>(
  projectId: string,
  path: string,
  options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<T> {
  const workspaceId = await projectWorkspaceId(projectId);
  const { data, error } = await supabase.functions.invoke("griot-orchestrator" + path, {
    method: options.method ?? "GET",
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers: {
      "x-griot-workspace-id": workspaceId,
      "content-type": "application/json",
    },
  });
  if (error) throw new Error(error.message || "O serviço de Capacidades não está disponível.");
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as Record<string, unknown>)["error"]));
  }
  if (!data || typeof data !== "object") throw new Error("Resposta inválida do servidor.");
  return data as T;
}

const scoped = (projectId: string) => "/projects/" + encodeURIComponent(projectId);
const agentScope = (projectId: string, agentId: string) =>
  scoped(projectId) + "/agents/" + encodeURIComponent(agentId);

export async function listProjectAgents(projectId: string) {
  const result = await orchestrator<{ agents: GriotRegisteredAgent[] }>(
    projectId,
    scoped(projectId) + "/agents",
  );
  return result.agents;
}

export async function registerProjectAgent(projectId: string, name: string) {
  const result = await orchestrator<{ agent: GriotRegisteredAgent }>(
    projectId,
    scoped(projectId) + "/agents",
    { method: "POST", body: { name } },
  );
  return result.agent;
}

export async function readPitchDeckCapability(projectId: string, agentId: string) {
  return orchestrator<PitchDeckCapability>(
    projectId,
    agentScope(projectId, agentId) + "/capabilities/pitch_deck.generate",
  );
}

export async function setPitchDeckCapability(projectId: string, agentId: string, enabled: boolean) {
  return orchestrator<PitchDeckCapability>(
    projectId,
    agentScope(projectId, agentId) + "/capabilities/pitch_deck.generate",
    { method: "PUT", body: { enabled } },
  );
}

export async function listAgentPitchDecks(projectId: string, agentId: string) {
  const result = await orchestrator<{ artifacts: AgentPitchDeck[] }>(
    projectId,
    agentScope(projectId, agentId) + "/pitch-decks",
  );
  return result.artifacts;
}

export async function getAgentPitchDeck(projectId: string, agentId: string, artifactId: string) {
  return orchestrator<AgentDeckDetail>(
    projectId,
    agentScope(projectId, agentId) + "/pitch-decks/" + encodeURIComponent(artifactId),
  );
}

export type AgentToolTrace = {
  step: number;
  tool: string;
  status: number;
  ok: boolean;
  approvalRequired?: boolean;
};

export type AgentChatResponse = {
  conversationId: string;
  result: { content: string };
  context?: { studioToolTrace?: AgentToolTrace[] };
};

/**
 * A conversation belongs to the selected registered agent.
 * The orchestrator binds agent_id on first use and refuses cross-agent reuse.
 * This invokes the REAL agent runtime, not a user-facing deck-generation form.
 */
export async function askProjectAgent(input: {
  projectId: string;
  agentId: string;
  prompt: string;
  conversationId?: string;
}): Promise<AgentChatResponse> {
  if (!input.prompt.trim()) throw new Error("A mensagem não pode estar vazia.");
  const result = await orchestrator<AgentChatResponse>(input.projectId, "/ask", {
    method: "POST",
    body: {
      prompt: input.prompt.trim(),
      projectId: input.projectId,
      agentId: input.agentId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      maxAgentSteps: 6,
    },
  });
  if (!result.conversationId || typeof result.result?.content !== "string") {
    throw new Error("O agente não devolveu uma conversa válida.");
  }
  return result;
}
