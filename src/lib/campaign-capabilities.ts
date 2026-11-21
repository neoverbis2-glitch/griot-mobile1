/** Agent-native Marketing Campaign Studio capability API.
 * Only admin configuration is callable from the browser; actual campaign
 * tools are deliberately restricted to the authenticated server-side agent bridge.
 */
import { supabase } from "@/integrations/supabase/client";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";

export const AGENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface AgentIdentity { id:string; label:string; }
export interface AgentProject { id:string; name:string; }
export interface AgentCapabilityCatalog { projects: AgentProject[]; agents: AgentIdentity[]; workspaceId:string; }

async function activeWorkspace() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Inicia sessão para gerir capacidades.");
  const workspaceId = await getPrimaryWorkspaceId(data.user.id);
  if (!workspaceId || !AGENT_UUID_RE.test(workspaceId)) throw new Error("Workspace autenticado não encontrado.");
  return workspaceId;
}
export async function loadAgentMarketingCatalog(): Promise<AgentCapabilityCatalog> {
  const workspaceId = await activeWorkspace();
  const [p, a] = await Promise.all([
    (supabase as any).from("griot_studio_projects").select("id,name")
      .eq("workspace_id",workspaceId).order("updated_at",{ascending:false}),
    (supabase as any).from("griot_pipeline_configs").select("nodes")
      .eq("workspace_id",workspaceId).limit(1).maybeSingle()
  ]);
  if (p.error) throw new Error("Não foi possível carregar projetos: "+p.error.message);
  // Pipeline configuration may not represent registered agents. Never invent IDs.
  if (a.error) throw new Error("Não foi possível confirmar os agentes: "+a.error.message);
  const projects: AgentProject[] = (Array.isArray(p.data) ? p.data : [])
    .filter((r: any) => typeof r?.id === "string" && AGENT_UUID_RE.test(r.id))
    .map((r: any) => ({id:r.id,name:String(r.name||"Projeto")}));
  const seen = new Set<string>();
  const agents: AgentIdentity[] = (Array.isArray(a.data?.nodes) ? a.data.nodes : [])
    .filter((r:any) => {
      if (typeof r?.id!=="string" || !AGENT_UUID_RE.test(r.id) || seen.has(r.id) || r.enabled===false) return false;
      seen.add(r.id);return true;
    })
    .map((r:any)=>({id:r.id,label:String(r.name||r.role||r.label||"Agente")}));
  return {workspaceId,projects,agents};
}
type CapabilityResponse = { capability:string; agentId:string; enabled:boolean; saved?:boolean; updatedAt?:string };
async function invokeCapability(workspaceId:string,projectId:string,agentId:string,enabled?:boolean):Promise<CapabilityResponse>{
  if (![workspaceId,projectId,agentId].every(x=>AGENT_UUID_RE.test(x))) throw new Error("Identificador de agente ou projeto inválido.");
  const {data,error}=await supabase.functions.invoke(
    `griot-campaign/projects/${projectId}/agents/${agentId}/capability`,
    {method:enabled===undefined?"GET":"POST",...(enabled===undefined?{}:{body:{enabled}}),headers:{"x-griot-workspace-id":workspaceId}}
  );
  if(error) throw new Error(error.message||"O backend recusou a configuração.");
  if(!data || typeof data!=="object" || data.capability!=="marketing_campaign_studio" || data.agentId!==agentId || typeof data.enabled!=="boolean")
    throw new Error("O backend não confirmou a identidade ou o estado da capacidade.");
  if(enabled!==undefined && (data.enabled!==enabled || data.saved!==true))
    throw new Error("A configuração não foi confirmada pelo backend.");
  return data as CapabilityResponse;
}
export async function readAgentMarketingCapability(workspaceId:string,projectId:string,agentId:string) {
  return invokeCapability(workspaceId,projectId,agentId);
}
export async function setAgentMarketingCapability(workspaceId:string,projectId:string,agentId:string,enabled:boolean) {
  return invokeCapability(workspaceId,projectId,agentId,enabled);
}
