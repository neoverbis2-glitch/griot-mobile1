import { useState, type FormEvent } from "react";
import { Bot, Send, LoaderCircle } from "lucide-react";
import { askProjectAgent } from "@/lib/agent-capabilities";

type ConversationMessage = { role: "user" | "agent"; content: string };

export function ProjectAgentChat({
  projectId,
  agentId,
  onArtifactsChanged,
}: {
  projectId: string;
  agentId: string;
  onArtifactsChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    setMessages((existing) => [...existing, { role: "user", content: prompt }]);
    try {
      const response = await askProjectAgent({ projectId, agentId, prompt, conversationId });
      setConversationId(response.conversationId);
      setMessages((existing) => [
        ...existing,
        { role: "agent", content: response.result.content },
      ]);
      if (response.context?.studioToolTrace?.some(
        (entry) => entry.tool === "pitch_deck.generate" && entry.ok,
      )) {
        onArtifactsChanged();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      aria-label="Conversa do agente"
      className="space-y-3 rounded-[22px] border border-hairline bg-surface p-4"
    >
      <header className="flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <div>
          <h4 className="text-[15px] font-semibold">Chat do agente</h4>
          <p className="text-[12px] text-muted-foreground">
            O agente executa as capacidades que lhe forem autorizadas.
          </p>
        </div>
      </header>
      <div aria-live="polite" className="max-h-72 space-y-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="rounded-xl bg-secondary/40 p-3 text-[12px] text-muted-foreground">
            Conversa diretamente com este agente. Podes pedir uma apresentação,
            explicar um produto ou solicitar alterações.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap break-words ${message.role === "user" ? "ml-7 bg-primary text-primary-foreground" : "mr-7 bg-secondary/50 text-foreground"}`}
          >
            <p className="mb-1 text-[11px] font-semibold opacity-70">
              {message.role === "user" ? "Tu" : "Agente"}
            </p>
            {message.content}
          </div>
        ))}
        {sending && (
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" /> Agente a executar...
          </p>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}
      <form onSubmit={(event) => void handleSubmit(event)} className="flex items-end gap-2">
        <label className="sr-only" htmlFor="project-agent-chat-input">Mensagem ao agente</label>
        <textarea
          id="project-agent-chat-input"
          rows={2}
          maxLength={20000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escreve ao agente..."
          className="min-w-0 flex-1 resize-none rounded-xl border border-hairline bg-background px-3 py-2 text-[13px]"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Enviar mensagem ao agente"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Necessita de uma credencial de modelo ativa no backend do Griot. Os
        ficheiros criados pelo agente aparecem acima após a execução.
      </p>
    </section>
  );
}
