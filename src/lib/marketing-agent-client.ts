/** Opt-in bridge from a project agent chat session to the verified server tool loop. */
import { supabase } from "@/integrations/supabase/client";
import { GRIOT_SUPABASE_URL, GRIOT_SUPABASE_ANON_KEY, getPrimaryWorkspaceId } from "@/lib/griot-api";
import { resolveProviderAndModel } from "@/lib/ai-client-mobile-entry";
import { AGENT_UUID_RE } from "@/lib/campaign-capabilities";
import type { AIResponse, StreamCallbacks } from "@/lib/ai-client-mobile-entry";

const SUPPORTED=new Set(["gemini","openai","anthropic","groq","openrouter"]);
export async function runMarketingAgentChat(input:{
  projectId:string;agentId:string;modelId:string;prompt:string;
  callbacks?:StreamCallbacks;signal?:AbortSignal;
}):Promise<AIResponse>{
  if(!AGENT_UUID_RE.test(input.projectId)||!AGENT_UUID_RE.test(input.agentId))throw new Error("O agente não tem uma identidade válida.");
  const prompt=input.prompt.trim();
  if(!prompt)throw new Error("Mensagem vazia.");
  const session=await supabase.auth.getSession();
  const accessToken=session.data.session?.access_token, userId=session.data.session?.user?.id;
  if(session.error||!accessToken||!userId)throw new Error("Sessão inválida: inicia sessão novamente.");
  const workspaceId=await getPrimaryWorkspaceId(userId);
  if(!workspaceId)throw new Error("Workspace indisponível para executar o agente.");
  const resolved=resolveProviderAndModel(input.modelId);
  const provider=resolved.provider==="claude"?"anthropic":resolved.provider;
  if(!SUPPORTED.has(provider))throw new Error("Este agente requer um fornecedor cloud suportado no backend.");
  input.callbacks?.onReasoning?.("A executar o agente no servidor…\n");
  const response=await fetch(`${GRIOT_SUPABASE_URL}/functions/v1/griot-orchestrator/ask`,{
    method:"POST",
    headers:{
      authorization:`Bearer ${accessToken}`,
      apikey:GRIOT_SUPABASE_ANON_KEY,
      "content-type":"application/json",
      "x-griot-workspace-id":workspaceId,
    },
    body:JSON.stringify({prompt,provider,model:resolved.modelName,projectId:input.projectId,agentId:input.agentId,maxAgentSteps:8}),
    signal:input.signal,
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data||typeof data!=="object"){
    throw new Error(typeof data?.error==="string"?data.error:`Não foi possível executar o agente (HTTP ${response.status}).`);
  }
  const result=String(data.result?.content||"");
  if(!result.trim())throw new Error("A execução do agente não devolveu uma resposta.");
  input.callbacks?.onToken?.(result);
  return {text:result,reasoning:"",toolCalls:[]};
}
