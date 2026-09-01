import { createFileRoute } from "@tanstack/react-router";
import { generateContentWithFallback } from "@/lib/gemini.server";

/** Transcrição de alta fidelidade e baixa latência para a voz do GRIOT. */
export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const file = form.get("audio");
          if (!(file instanceof File)) return new Response("Sem áudio", { status: 400 });
          if (file.size < 600) {
            return new Response(JSON.stringify({ text: "" }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const mode = String(form.get("mode") ?? "partial");
          const prompt = String(form.get("prompt") ?? "").slice(0, 800);
          const baseMime = (file.type || "audio/webm").split(";")[0] ?? "audio/webm";
          const arrayBuffer = await file.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString("base64");

          // Para janelas parciais usamos Flash-Lite; para o turno final tentamos 3.5-transcribe com fallback para Flash-Lite
          const candidateModels =
            mode === "final"
              ? ["gemini-3.5-transcribe", "gemini-3.1-flash-lite"]
              : ["gemini-3.1-flash-lite", "gemini-3.5-transcribe"];

          const { result: response } = await generateContentWithFallback({
            models: candidateModels,
            contents: [
              {
                inlineData: {
                  data: base64Audio,
                  mimeType: baseMime,
                },
              },
              {
                text: prompt
                  ? `Transcreve este áudio com fidelidade total no idioma falado. Contexto recente da conversa: ${prompt}. Responde apenas com a fala transcrita.`
                  : "Transcreve este áudio com fidelidade total no idioma falado. Responde apenas com a fala transcrita.",
              },
            ],
            config: {
              systemInstruction:
                "És um motor de Speech-to-Text de alta precisão. Transcreve com exatidão o áudio fornecido. Não adiciones comentários, explicações, saudações ou aspas. Se o áudio contiver apenas ruído de fundo, estática ou silêncio, devolve apenas vazio.",
              temperature: 0,
            },
          });

          let text = (response.text ?? "").trim();
          // Remove possíveis aspas adicionadas pelo modelo
          if (
            (text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("'") && text.endsWith("'")) ||
            (text.startsWith("«") && text.endsWith("»"))
          ) {
            text = text.slice(1, -1).trim();
          }

          return new Response(JSON.stringify({ text }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("STT transcription error:", error);
          return new Response(JSON.stringify({ text: "" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
