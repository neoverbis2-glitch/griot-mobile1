import { supabase } from "@/integrations/supabase/client";

/**
 * Primeiro arranque de uma conta: cria o ecossistema inicial do utilizador
 * para que Home, Projects e Control tenham conteúdo real desde o primeiro segundo.
 */
export async function bootstrapWorkspace(userId: string) {
  const { data: existing } = await supabase.from("projects").select("id").limit(1);
  if (existing && existing.length > 0) return;

  const { data: projects } = await supabase
    .from("projects")
    .insert([
      {
        user_id: userId,
        name: "Neoverbis",
        description: "Plataforma editorial e de tradução assistida.",
        progress: 92,
        build_status: "success",
      },
      {
        user_id: userId,
        name: "ModelOS",
        description: "Camada de orquestração de modelos do GRIOT.",
        progress: 47,
        build_status: "running",
      },
    ])
    .select("id, name");

  const neoverbis = projects?.find((project) => project.name === "Neoverbis");
  const modelos = projects?.find((project) => project.name === "ModelOS");
  if (!neoverbis) return;

  await supabase.from("profiles").update({ active_project_id: neoverbis.id }).eq("id", userId);

  await supabase.from("tasks").insert([
    {
      user_id: userId,
      project_id: neoverbis.id,
      title: "Rever fluxo de revisão editorial",
      status: "doing",
      priority: "high",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      title: "Fechar exportação em EPUB",
      status: "todo",
      priority: "normal",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      title: "Testes de carga na API",
      status: "done",
      priority: "normal",
    },
  ]);

  await supabase.from("pull_requests").insert([
    {
      user_id: userId,
      project_id: neoverbis.id,
      number: 128,
      title: "Nova camada de cache para traduções",
      branch: "feat/cache-traducoes",
      summary: "Reduz em 40% o tempo de resposta em documentos longos.",
      status: "pending",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      number: 127,
      title: "Correção de acentuação no importador",
      branch: "fix/importador",
      summary: "Normalização Unicode no pipeline de ingestão.",
      status: "pending",
    },
  ]);

  await supabase.from("logs").insert([
    {
      user_id: userId,
      project_id: neoverbis.id,
      level: "info",
      source: "build",
      message: "Deploy realizado com sucesso.",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      level: "warn",
      source: "api",
      message: "Latência acima do normal em /translate.",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      level: "info",
      source: "agent",
      message: "Agente Revisor concluiu 14 tarefas.",
    },
  ]);

  await supabase
    .from("alerts")
    .insert([
      { user_id: userId, project_id: neoverbis.id, kind: "deploy", message: "Deploy realizado" },
    ]);

  await supabase.from("agents").insert([
    {
      user_id: userId,
      project_id: neoverbis.id,
      name: "Revisor",
      role: "Qualidade editorial",
      status: "active",
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      name: "Tradutor",
      role: "Tradução assistida",
      status: "active",
    },
    {
      user_id: userId,
      project_id: modelos?.id ?? neoverbis.id,
      name: "Orquestrador",
      role: "Encaminhamento de modelos",
      status: "active",
    },
    {
      user_id: userId,
      project_id: modelos?.id ?? neoverbis.id,
      name: "Observador",
      role: "Monitorização de custos",
      status: "active",
    },
  ]);

  await supabase.from("runs").insert([
    {
      user_id: userId,
      project_id: neoverbis.id,
      label: "Build #482",
      status: "success",
      duration_ms: 84000,
      cost_usd: 0.12,
    },
    {
      user_id: userId,
      project_id: neoverbis.id,
      label: "Revisão de 240 parágrafos",
      status: "success",
      duration_ms: 213000,
      cost_usd: 0.87,
    },
    {
      user_id: userId,
      project_id: modelos?.id ?? neoverbis.id,
      label: "Sincronização de modelos",
      status: "running",
      cost_usd: 0.04,
    },
  ]);

  await supabase.from("services").insert([
    {
      user_id: userId,
      name: "OpenAI",
      kind: "model",
      status: "operational",
      usage_units: 18420,
      cost_usd: 42.1,
    },
    {
      user_id: userId,
      name: "Gemini",
      kind: "model",
      status: "operational",
      usage_units: 9310,
      cost_usd: 11.4,
    },
    {
      user_id: userId,
      name: "Cloud",
      kind: "infra",
      status: "operational",
      usage_units: 1,
      cost_usd: 18.0,
    },
    {
      user_id: userId,
      name: "Storage",
      kind: "infra",
      status: "degraded",
      usage_units: 1,
      cost_usd: 3.2,
    },
  ]);
}
