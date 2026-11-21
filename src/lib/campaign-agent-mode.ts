/** Explicit project-scoped agent chat mode. Browser state controls selection, never authorization. */
import { AGENT_UUID_RE } from "@/lib/campaign-capabilities";

const KEY="griot_marketing_active_agent_v1";
type AgentSelection={projectId:string;agentId:string};

export function getActiveMarketingAgent(projectId:string|null|undefined):string|null{
  if(import.meta.env["VITE_GRIOT_AGENT_CAMPAIGN_CAPABILITIES"]!=="enabled"||!projectId||typeof window==="undefined")return null;
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw)return null;
    const data=JSON.parse(raw) as AgentSelection;
    return data.projectId===projectId&&AGENT_UUID_RE.test(data.agentId)?data.agentId:null;
  }catch{return null;}
}
export function setActiveMarketingAgent(projectId:string,agentId:string|null):void{
  if(typeof window==="undefined")return;
  if(!agentId){localStorage.removeItem(KEY);window.dispatchEvent(new Event("griot-marketing-agent-changed"));return;}
  if(!AGENT_UUID_RE.test(projectId)||!AGENT_UUID_RE.test(agentId))throw new Error("Identidade inválida para o agente.");
  localStorage.setItem(KEY,JSON.stringify({projectId,agentId} satisfies AgentSelection));
  window.dispatchEvent(new Event("griot-marketing-agent-changed"));
}
