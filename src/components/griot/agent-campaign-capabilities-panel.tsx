/** Owner/admin configuration surface; campaign generation stays inside the agents. */
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Megaphone } from "lucide-react";
import { Panel } from "@/components/griot/screen";
import {
  loadAgentMarketingCatalog, readAgentMarketingCapability, setAgentMarketingCapability,
  type AgentProject, type AgentIdentity
} from "@/lib/campaign-capabilities";

export function AgentCampaignCapabilitiesPanel() {
  const [workspaceId,setWorkspaceId]=useState("");
  const [projects,setProjects]=useState<AgentProject[]>([]);
  const [agents,setAgents]=useState<AgentIdentity[]>([]);
  const [projectId,setProjectId]=useState("");
  const [agentId,setAgentId]=useState("");
  const [enabled,setEnabled]=useState(false);
  const [pending,setPending]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [ready,setReady]=useState(false);

  async function reload(){
    setLoading(true);setReady(false);setError("");
    try {
      const data=await loadAgentMarketingCatalog();
      setWorkspaceId(data.workspaceId);setProjects(data.projects);setAgents(data.agents);
      setProjectId(prev=>data.projects.some(p=>p.id===prev)?prev:(data.projects[0]?.id||""));
      setAgentId(prev=>data.agents.some(a=>a.id===prev)?prev:(data.agents[0]?.id||""));
    } catch(e){setError(e instanceof Error?e.message:"Erro ao carregar capacidades.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void reload();},[]);
  useEffect(()=>{
    let active=true;
    setReady(false);setEnabled(false);
    if(!workspaceId||!projectId||!agentId)return;
    void readAgentMarketingCapability(workspaceId,projectId,agentId)
      .then(result=>{if(active){setEnabled(result.enabled);setReady(true);setError("");}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Falha a ler a capacidade.");});
    return()=>{active=false;};
  },[workspaceId,projectId,agentId]);

  async function toggle(next:boolean) {
    if(!ready||pending)return;
    setPending(true);setError("");
    try{
      const result=await setAgentMarketingCapability(workspaceId,projectId,agentId,next);
      setEnabled(result.enabled);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível guardar.");}
    finally{setPending(false);}
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="pt-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Capacidades dos agentes</p>
        <button type="button" onClick={()=>void reload()} disabled={loading||pending}
          aria-label="Atualizar lista de agentes" className="rounded-full p-2 text-muted-foreground disabled:opacity-40">
          <RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/>
        </button>
      </div>
      <Panel className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary"><Megaphone className="size-5"/></span>
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px]">Marketing Campaign Studio</h3>
            <p className="text-[12.5px] text-muted-foreground">Capacidade nativa ativada por agente e por projeto. Os criativos são executados no backend, não neste painel.</p>
          </div>
        </div>
        {loading?<p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar…</p>:null}
        {!loading&&(!projects.length||!agents.length)?(
          <p className="text-[12.5px] text-muted-foreground">É necessário um projeto e um agente com identificador UUID válido no registo de configuração. Não são criados agentes fictícios.</p>
        ):null}
        {projects.length>0&&agents.length>0?(
          <>
            <label className="block text-[12px] text-muted-foreground">Projeto
              <select value={projectId} onChange={e=>setProjectId(e.target.value)} disabled={pending||loading}
                className="mt-1 w-full rounded-xl border border-hairline bg-background px-3 py-2.5 text-[13px] text-foreground">
                {projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-muted-foreground">Agente
              <select value={agentId} onChange={e=>setAgentId(e.target.value)} disabled={pending||loading}
                className="mt-1 w-full rounded-xl border border-hairline bg-background px-3 py-2.5 text-[13px] text-foreground">
                {agents.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}
              </select>
            </label>
            <button type="button" role="switch" aria-checked={enabled} disabled={!ready||pending||loading}
              onClick={()=>void toggle(!enabled)}
              className="flex w-full items-center justify-between rounded-xl border border-hairline px-3 py-3 text-left disabled:opacity-50">
              <span className="text-[13px] font-medium">{pending?"A guardar…":ready?(enabled?"Ativado para este agente":"Desativado para este agente"):"A verificar permissão…"}</span>
              <span aria-hidden="true" className={`relative h-6 w-11 rounded-full ${enabled?"bg-primary":"bg-secondary"}`}>
                <span className={`absolute top-1 size-4 rounded-full bg-background transition-transform ${enabled?"translate-x-6":"translate-x-1"}`}/>
              </span>
            </button>
          </>
        ):null}
        {error?<p role="alert" className="text-[12px] text-destructive">{error}</p>:null}
      </Panel>
    </div>
  );
}
