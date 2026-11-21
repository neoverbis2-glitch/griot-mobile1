import { useCallback, useEffect, useState } from "react";
import { Bot, Presentation, Plus, RefreshCcw, ShieldCheck, Download, Eye } from "lucide-react";
import {
  listProjectAgents, registerProjectAgent, readPitchDeckCapability,
  setPitchDeckCapability, listAgentPitchDecks, getAgentPitchDeck,
  type GriotRegisteredAgent, type AgentPitchDeck, type AgentDeckDetail,
} from "@/lib/agent-capabilities";

export function AgentCapabilitiesPanel({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<GriotRegisteredAgent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [artifacts, setArtifacts] = useState<AgentPitchDeck[]>([]);
  const [selected, setSelected] = useState<AgentDeckDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reloadAgents = useCallback(async () => {
    const items = await listProjectAgents(projectId);
    setAgents(items);
    setAgentId((previous) => items.some((item) => item.id === previous)
      ? previous : items[0]?.id ?? "");
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void listProjectAgents(projectId)
      .then((items) => {
        if (!alive) return;
        setAgents(items);
        setAgentId(items[0]?.id || "");
      })
      .catch((cause) => { if (alive) setError(String(cause instanceof Error ? cause.message : cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setSelected(null);
    setEnabled(null);
    setArtifacts([]);
    if (!agentId) return () => { alive = false; };
    setLoading(true);
    setError("");
    void Promise.all([readPitchDeckCapability(projectId, agentId), listAgentPitchDecks(projectId, agentId)])
      .then(([capability, decks]) => {
        if (!alive) return;
        setEnabled(capability.enabled);
        setArtifacts(decks);
      })
      .catch((cause) => { if (alive) setError(String(cause instanceof Error ? cause.message : cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, agentId]);

  async function addAgent() {
    if (busy || !newAgentName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const agent = await registerProjectAgent(projectId, newAgentName.trim());
      setNewAgentName("");
      await reloadAgents();
      setAgentId(agent.id);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCapability() {
    if (busy || !agentId || enabled === null) return;
    setBusy(true);
    setError("");
    try {
      const result = await setPitchDeckCapability(projectId, agentId, !enabled);
      const confirmed = await readPitchDeckCapability(projectId, agentId);
      if (confirmed.enabled !== result.enabled) throw new Error("A alteração não foi confirmada pelo servidor.");
      setEnabled(confirmed.enabled);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  }

  async function openDeck(id: string) {
    if (busy || !agentId) return;
    setBusy(true);
    setError("");
    try {
      setSelected(await getAgentPitchDeck(projectId, agentId, id));
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  }

  async function reloadDecks() {
    if (!agentId || busy) return;
    setBusy(true);
    setError("");
    try {
      setArtifacts(await listAgentPitchDecks(projectId, agentId));
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Capacidades dos agentes" className="space-y-4 rise">
      <div className="rounded-[22px] border border-hairline bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-primary" />
          <h3 className="text-[16px] font-semibold">Capacidades dos agentes</h3>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Aqui geres as permissões. As apresentações são geradas pelos próprios agentes, e não por um formulário do utilizador.
        </p>
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
        <label className="block text-[13px] font-medium" htmlFor="agent-capabilities-select">Agente</label>
        <select id="agent-capabilities-select" className="w-full rounded-xl border border-hairline bg-background p-3 text-[14px]"
          value={agentId} onChange={(event) => setAgentId(event.target.value)}>
          {agents.length === 0 && <option value="">Sem agentes registados</option>}
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void addAgent(); }}>
          <input type="text" maxLength={100} aria-label="Nome do novo agente" placeholder="Registar agente neste projeto"
            className="min-w-0 flex-1 rounded-xl border border-hairline bg-background px-3 py-2.5 text-[13px]"
            value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} />
          <button type="submit" disabled={busy || !newAgentName.trim()} aria-label="Registar agente"
            className="rounded-xl bg-primary px-3 text-primary-foreground disabled:opacity-40">
            <Plus className="size-4" />
          </button>
        </form>
      </div>

      {agentId && (
        <div className="rounded-[22px] border border-hairline bg-surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Presentation className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <h4 className="text-[15px] font-semibold">Pitch Deck Generator</h4>
              <p className="text-[12px] text-muted-foreground">Tool: pitch_deck.generate</p>
            </div>
            <button type="button" role="switch" aria-checked={Boolean(enabled)} aria-label="Ativar Pitch Deck Generator para este agente"
              disabled={busy || loading || enabled === null} onClick={() => void toggleCapability()}
              className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${enabled ? "bg-primary" : "bg-secondary"}`}>
              <span className={`absolute top-1 size-5 rounded-full bg-white transition-all ${enabled ? "left-6" : "left-1"}`} />
            </button>
          </div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            {enabled ? "O agente pode gerar apresentações PPTX neste projeto." : "A geração está desativada para este agente."}
          </p>
          <div className="flex items-center justify-between border-t border-hairline pt-3">
            <span className="text-[13px] font-semibold">Apresentações do agente ({artifacts.length})</span>
            <button disabled={busy || loading} onClick={() => void reloadDecks()} type="button"
              className="rounded-lg p-2 hover:bg-secondary" aria-label="Atualizar apresentações"><RefreshCcw className="size-4" /></button>
          </div>
          {artifacts.length === 0 && !loading && <p className="text-[12px] text-muted-foreground">Ainda não existem apresentações guardadas.</p>}
          {artifacts.map((deck) => (
            <button key={deck.id} type="button" disabled={busy} onClick={() => void openDeck(deck.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-left hover:bg-secondary/50 disabled:opacity-50">
              <Eye className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{deck.presentation_json.title}</span>
              <span className="text-[11px] text-muted-foreground">{deck.presentation_json.slides.length + 1} slides</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-[22px] border border-hairline bg-surface p-4 space-y-3">
          <h4 className="text-[16px] font-semibold">{selected.presentation.title}</h4>
          <p className="text-[12px] text-muted-foreground">Estrutura dos slides. A pré-visualização visual completa será integrada separadamente.</p>
          {selected.presentation.slides.map((slide, index) => (
            <div key={index} className="rounded-xl border border-hairline bg-background p-3 space-y-1">
              <p className="text-[12px] font-semibold">{index + 2}. {slide.title}</p>
              <p className="text-[11px] text-muted-foreground">{slide.bullets.join(" · ")}</p>
              <p className="text-[10px] uppercase text-muted-foreground">{slide.evidence}</p>
            </div>
          ))}
          <a href={selected.signedUrl} download={selected.fileName} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground">
            <Download className="size-4" /> Descarregar PPTX editável
          </a>
          <p className="text-[11px] text-muted-foreground">A ligação de descarga expira em 15 minutos.</p>
        </div>
      )}
    </section>
  );
}
