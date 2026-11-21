/** Admin panel for permissions of actual registered project agents, not for user-facing campaigns. */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw, Megaphone } from "lucide-react";
import { Panel } from "@/components/griot/screen";
import { setActiveMarketingAgent, getActiveMarketingAgent } from "@/lib/campaign-agent-mode";
import { setActiveProject } from "@/lib/project-service";
import {
  loadAgentMarketingCatalog, loadRegisteredCampaignAgents, registerCampaignAgent,
  readAgentMarketingCapability, setAgentMarketingCapability,
  type AgentProject, type AgentIdentity
} from "@/lib/campaign-capabilities";

export function AgentCampaignCapabilitiesPanel() {
  const [workspaceId,setWorkspaceId]=useState("");
  const [projects,setProjects]=useState<AgentProject[]>([]);
  const [projectId,setProjectId]=useState("");
  const [agents,setAgents]=useState<AgentIdentity[]>([]);
  const [agentId,setAgentId]=useState("");
  const [agentName,setAgentName]=useState("");
  const [enabled,setEnabled]=useState(false);
  const [pending,setPending]=useState(false);
  const [registering,setRegistering]=useState(false);
  const [loading,setLoading]=useState(true);
  const [loadingAgents,setLoadingAgents]=useState(false);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  const [registrationMessage,setRegistrationMessage]=useState("");
  const [chatSelected,setChatSelected]=useState(false);

  async function reload() {
    setLoading(true);setReady(false);setError("");setRegistrationMessage("");
    try {
      const data=await loadAgentMarketingCatalog();
      setWorkspaceId(data.workspaceId);setProjects(data.projects);
      setProjectId(prev=>data.projects.some(p=>p.id===prev)?prev:(data.projects[0]?.id||""));
    } catch (e) {setError(e instanceof Error?e.message:"Falha ao carregar os projetos.");}
    finally {setLoading(false);}
  }
  useEffect(()=>{void reload();},[]);
  useEffect(()=>{
    let active=true;
    setAgents([]);setAgentId("");setReady(false);setEnabled(false);
    if(!workspaceId||!projectId)return;
    setLoadingAgents(true);setRegistrationMessage("");
    void loadRegisteredCampaignAgents(workspaceId,projectId)
      .then(list=>{
        if(!active)return;
        setAgents(list);
        setAgentId(list.find(agent=>agent.status==="active")?.id||"");
        setError("");
      }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Falha ao carregar agentes.");})
      .finally(()=>{if(active)setLoadingAgents(false);});
    return()=>{active=false;};
  },[workspaceId,projectId]);
  useEffect(()=>{
    let active=true;
    setReady(false);setEnabled(false);
    const selected=agents.find(a=>a.id===agentId);
    if(!workspaceId||!projectId||!agentId||selected?.status!=="active")return;
    void readAgentMarketingCapability(workspaceId,projectId,agentId)
      .then(result=>{if(active){setEnabled(result.enabled);setReady(true);setError("");}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Falha ao consultar autorização.");});
    return()=>{active=false;};
  },[workspaceId,projectId,agentId,agents]);

  useEffect(()=>{setChatSelected(!!agentId && getActiveMarketingAgent(projectId)===agentId);},[projectId,agentId]);
  function selectChatAgent() {
    if(!ready||!enabled)return;
    setActiveMarketingAgent(projectId,agentId);
    setActiveProject(projectId);
    setChatSelected(true);
    setRegistrationMessage("Agente escolhido. Abre uma conversa do projeto no chat para utilizar as ferramentas nativas.");
  }
  function clearChatAgent() {
    setActiveMarketingAgent(projectId,null);
    setChatSelected(false);
    setRegistrationMessage("Modo agente desativado no chat.");
  }
  async function register() {
    if(registering||pending||!projectId||!agentName.trim())return;
    setRegistering(true);setError("");setRegistrationMessage("");
    try{
      const created=await registerCampaignAgent(workspaceId,projectId,agentName);
      setAgents(prev=>[created,...prev]);setAgentId(created.id);setAgentName("");
      setRegistrationMessage("Agente registado. A execução só poderá usar esta identidade quando for selecionada no runtime.");
    } catch(e){setError(e instanceof Error?e.message:"Não foi possível registar o agente.");}
    finally{setRegistering(false);}
  }
  async function toggle(next:boolean) {
    if(!ready||pending)return;
    setPending(true);setError("");setRegistrationMessage("");
    try {
      const result=await setAgentMarketingCapability(workspaceId,projectId,agentId,next);
      setEnabled(result.enabled);
      if(!next && getActiveMarketingAgent(projectId)===agentId)clearChatAgent();
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível guardar a permissão.");}
    finally{setPending(false);}
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="pt-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Capacidades dos agentes</p>
        <button type="button" onClick={()=>void reload()} disabled={loading||pending||registering}
          aria-label="Atualizar projetos" className="rounded-full p-2 text-muted-foreground disabled:opacity-40">
          <RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/>
        </button>
      </div>
      <Panel className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary"><Megaphone className="size-5"/></span>
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px]">Marketing Campaign Studio</h3>
            <p className="text-[12.5px] text-muted-foreground">Permissão por agente e por projeto. A campanha é produzida pelo agente no servidor, nunca diretamente neste painel.</p>
          </div>
        </div>
        {loading?<p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar projetos…</p>:null}
        {!loading&&!projects.length?<p className="text-[12.5px] text-muted-foreground">Não existem projetos disponíveis para configurar.</p>:null}
        {projects.length>0?(
          <>
            <label className="block text-[12px] text-muted-foreground">Projeto
              <select value={projectId} onChange={e=>setProjectId(e.target.value)} disabled={pending||loading}
                className="mt-1 w-full rounded-xl border border-hairline bg-background px-3 py-2.5 text-[13px] text-foreground">
                {projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
            </label>
            {loadingAgents?<p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar identidades dos agentes…</p>:null}
            <label className="block text-[12px] text-muted-foreground">Agente registado
              <select value={agentId} onChange={e=>setAgentId(e.target.value)}
                disabled={pending||loadingAgents||!agents.some(a=>a.status==="active")}
                className="mt-1 w-full rounded-xl border border-hairline bg-background px-3 py-2.5 text-[13px] text-foreground">
                {!agentId?<option value="">Selecionar agente ativo</option>:null}
                {agents.filter(a=>a.status==="active").map(a=><option value={a.id} key={a.id}>{a.label}</option>)}
              </select>
            </label>
            {!loadingAgents&&!agents.some(a=>a.status==="active")?<p className="text-[12.5px] text-muted-foreground">Ainda não existe um agente ativo registado neste projeto.</p>:null}
            <div className="space-y-1.5 rounded-xl border border-hairline px-3 py-3">
              <p className="text-[12px] font-medium">Registar identidade de um agente no projeto</p>
              <div className="flex gap-2">
                <input type="text" value={agentName} onChange={e=>setAgentName(e.target.value)} maxLength={100}
                  placeholder="Nome do agente" aria-label="Nome do agente"
                  disabled={registering||loadingAgents} className="min-w-0 flex-1 rounded-xl border border-hairline bg-background px-3 py-2 text-[13px]"/>
                <button type="button" onClick={()=>void register()}
                  disabled={registering||!agentName.trim()||loadingAgents}
                  className="rounded-xl border border-hairline px-3 py-2 text-[12px] font-medium disabled:opacity-40">
                  {registering?"A registar…":"Registar"}
                </button>
              </div>
              <p className="text-[11.5px] text-muted-foreground">O registo cria uma identidade persistente; não inicia nem instala um agente.</p>
            </div>
            {agentId?(
              <button type="button" role="switch" aria-checked={enabled} disabled={!ready||pending||loadingAgents}
                onClick={()=>void toggle(!enabled)}
                className="flex w-full items-center justify-between rounded-xl border border-hairline px-3 py-3 text-left disabled:opacity-50">
                <span className="text-[13px] font-medium">{pending?"A guardar…":ready?(enabled?"Marketing ativado para este agente":"Marketing desativado para este agente"):"A verificar permissão…"}</span>
                <span aria-hidden="true" className={`relative h-6 w-11 rounded-full ${enabled?"bg-primary":"bg-secondary"}`}>
                  <span className={`absolute top-1 size-4 rounded-full bg-background transition-transform ${enabled?"translate-x-6":"translate-x-1"}`}/>
                </span>
              </button>
            ):null}
            {agentId&&enabled&&ready?(
              <div className="space-y-2 rounded-xl border border-hairline px-3 py-3">
                <p className="text-[12px] text-muted-foreground">Seleciona esta identidade para executar o agente no chat principal do projeto. O Quick Chat mantém-se independente.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={chatSelected?clearChatAgent:selectChatAgent}
                    className="flex-1 rounded-xl border border-hairline px-3 py-2 text-[12px] font-medium">
                    {chatSelected?"Desativar no chat":"Usar este agente no chat"}
                  </button>
                  {chatSelected?<Link to="/chat" className="rounded-xl border border-hairline px-3 py-2 text-[12px] font-medium">Abrir chat</Link>:null}
                </div>
              </div>
            ):null}
          </>
        ):null}
        {registrationMessage?<p role="status" className="text-[12px] text-muted-foreground">{registrationMessage}</p>:null}
        {error?<p role="alert" className="text-[12px] text-destructive">{error}</p>:null}
      </Panel>
    </div>
  );
}
