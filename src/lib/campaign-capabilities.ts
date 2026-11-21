/** Agent-native Marketing Campaign Studio capability API.
 * Only admin configuration is callable from the browser; actual campaign
 * tools are deliberately restricted to the authenticated server-side agent bridge.
 */
import { supabase } from "@/integrations/supabase/client";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";

export const AGENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface AgentIdentity { id:string; label:string; status:"active"|"disabled"; }
export interface AgentProject { id:string; name:string; }
export interface AgentCapabilityCatalog { projects: AgentProject[]; workspaceId:string; }

async function activeWorkspace() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Inicia sessão para gerir capacidades.");
  const workspaceId = await getPrimaryWorkspaceId(data.user.id);
  if (!workspaceId || !AGENT_UUID_RE.test(workspaceId)) throw new Error("Workspace autenticado não encontrado.");
  return workspaceId;
}
export async function loadAgentMarketingCatalog(): Promise<AgentCapabilityCatalog> {
  const workspaceId = await activeWorkspace();
  const p=await (supabase as any).from("griot_studio_projects").select("id,name")
    .eq("workspace_id",workspaceId).order("updated_at",{ascending:false});
  if (p.error) throw new Error("Não foi possível carregar projetos: "+p.error.message);
  const projects: AgentProject[] = (Array.isArray(p.data) ? p.data : [])
    .filter((r: any) => typeof r?.id === "string" && AGENT_UUID_RE.test(r.id))
    .map((r: any) => ({id:r.id,name:String(r.name||"Projeto")}));
  return {workspaceId,projects};
}
async function invokeCampaign<T>(workspaceId:string,path:string,method:"GET"|"POST",payload?:unknown):Promise<T>{
  const {data,error}=await supabase.functions.invoke(`griot-campaign${path}`,{
    method,...(payload===undefined?{}:{body:payload}),headers:{"x-griot-workspace-id":workspaceId}
  });
  if(error)throw new Error(error.message||"O backend de campanhas não está disponível.");
  if(data && typeof data==="object" && typeof (data as any).error==="string")
    throw new Error(String((data as any).error));
  return data as T;
}
export async function loadRegisteredCampaignAgents(workspaceId:string,projectId:string):Promise<AgentIdentity[]>{
  if(!AGENT_UUID_RE.test(workspaceId)||!AGENT_UUID_RE.test(projectId))throw new Error("Projeto ou workspace inválido.");
  const data=await invokeCampaign<{projectId:string;agents:{id:string;name:string;status:string}[]}>(
    workspaceId,`/projects/${projectId}/agents`,"GET"
  );
  if(data?.projectId!==projectId||!Array.isArray(data.agents))throw new Error("Resposta inválida do registo de agentes.");
  return data.agents.filter(a=>AGENT_UUID_RE.test(a.id)&&["active","disabled"].includes(a.status))
    .map(a=>({id:a.id,label:String(a.name||"Agente"),status:a.status as "active"|"disabled"}));
}
export async function registerCampaignAgent(workspaceId:string,projectId:string,name:string):Promise<AgentIdentity>{
  if(!AGENT_UUID_RE.test(workspaceId)||!AGENT_UUID_RE.test(projectId))throw new Error("Projeto ou workspace inválido.");
  const clean=name.trim().slice(0,100);if(!clean)throw new Error("Introduz um nome para o agente.");
  const data=await invokeCampaign<{registered:boolean;agent:{id:string;name:string;status:"active"|"disabled"}}>(
    workspaceId,`/projects/${projectId}/agents`,"POST",{name:clean}
  );
  if(data?.registered!==true||!AGENT_UUID_RE.test(data.agent?.id))throw new Error("O backend não confirmou o registo do agente.");
  return{id:data.agent.id,label:data.agent.name,status:data.agent.status};
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
