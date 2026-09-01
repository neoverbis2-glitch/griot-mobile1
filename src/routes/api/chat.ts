import { createFileRoute } from "@tanstack/react-router";
import { GRIOT_SUPABASE_ANON_KEY, GRIOT_SUPABASE_URL } from "@/lib/griot-api";
import { checkRateLimit, sanitizeInput, SECURITY_HEADERS } from "@/lib/security-headers";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const clientIp = request.headers.get("x-forwarded-for") || "127.0.0.1";
        const rateLimit = checkRateLimit(clientIp, 60, 60000);
        if (!rateLimit.allowed) {
          return new Response(
            JSON.stringify({ error: "Demasiados pedidos. Tenta daqui a pouco." }),
            { status: 429, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } },
          );
        }

        const authorization = request.headers.get("authorization") || "";
        if (!authorization.toLowerCase().startsWith("bearer ")) {
          return new Response(
            JSON.stringify({ error: "Sessão não autenticada. Inicia sessão novamente." }),
            { status: 401, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } },
          );
        }

        const body = (await request.json()) as {
          messages?: ChatMessage[];
          model?: string;
          effort?: "low" | "medium" | "high";
          conversationId?: string;
          conversationTitle?: string;
        };
        const rawMessages = body.messages ?? [];
        if (rawMessages.length === 0) {
          return new Response("Sem mensagens", { status: 400, headers: SECURITY_HEADERS });
        }

        const lastUserMessage = [...rawMessages].reverse().find((m) => m.role === "user");
        const prompt = sanitizeInput(lastUserMessage?.content || "", 20000);
        if (!prompt) {
          return new Response("Mensagem vazia", { status: 400, headers: SECURITY_HEADERS });
        }

        const rawModel = typeof body.model === "string" ? body.model : "";
        const isAppModel = rawModel.startsWith("app:");
        const [maybeProvider, ...modelParts] = rawModel.includes(":") ? rawModel.split(":") : [];
        const provider =
          !isAppModel &&
          maybeProvider &&
          ["gemini", "openai", "anthropic", "groq", "openrouter"].includes(maybeProvider)
            ? maybeProvider
            : "gemini";
        const model = !isAppModel && modelParts.length ? modelParts.join(":") : undefined;

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const emit = (t: "text" | "reason" | "step", d: string) => {
              controller.enqueue(encoder.encode(`${JSON.stringify({ t, d })}\n`));
            };
            try {
              const upstream = await fetch(
                `${GRIOT_SUPABASE_URL}/functions/v1/griot-orchestrator/ask`,
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    authorization,
                    apikey: GRIOT_SUPABASE_ANON_KEY,
                  },
                  body: JSON.stringify({
                    prompt,
                    provider,
                    model,
                    conversationId: body.conversationId || undefined,
                    conversationTitle: body.conversationTitle || undefined,
                  }),
                },
              );

              const payload = (await upstream.json().catch(() => ({}))) as {
                error?: string;
                result?: { content?: string };
              };

              if (!upstream.ok) {
                const message =
                  upstream.status === 409
                    ? "Ainda não ligaste uma chave de API de IA. Vai a Definições → Chave de IA para ligar uma (ex.: Gemini) antes de conversar."
                    : payload.error || "O GRIOT não conseguiu responder agora.";
                emit("text", message);
                controller.close();
                return;
              }

              const text = payload.result?.content || "";
              if (!text) {
                emit("text", "O modelo não devolveu texto.");
                controller.close();
                return;
              }

              const words = text.split(/(\s+)/);
              for (const word of words) {
                if (!word) continue;
                emit("text", word);
              }
            } catch (error) {
              console.error("api/chat -> griot-orchestrator error:", error);
              emit("text", "Não foi possível contactar o GRIOT. Verifica a tua ligação.");
            } font-medium: {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            ...SECURITY_HEADERS,
          },
        });
      },
    },
  },
});
