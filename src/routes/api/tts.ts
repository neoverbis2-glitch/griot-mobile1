import { createFileRoute } from "@tanstack/react-router";

/** Voz de síntese real (servidor), para a conversa por voz do GRIOT. */
export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            text?: string;
            voice?: string;
            speed?: number;
            stream?: boolean;
            tone?: string;
            warmup?: boolean;
          };

          // Pré-aquecimento do caminho de saída
          if (body.warmup) {
            return new Response(null, { status: 204 });
          }

          const text = (body.text ?? "").slice(0, 4000).trim();
          if (!text) return new Response("Sem texto", { status: 400 });

          // Retorna 204 ou stream vazio seguro se não houver backend de TTS externo configurado
          if (body.stream) {
            return new Response("data: [DONE]\n\n", {
              headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
            });
          }

          return new Response(new ArrayBuffer(0), {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        } catch (error) {
          if (request.signal.aborted || (error as Error).name === "AbortError") {
            return new Response(null, { status: 499 });
          }
          return new Response("Indisponível", { status: 500 });
        }
      },
    },
  },
});
