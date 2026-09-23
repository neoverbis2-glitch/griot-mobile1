import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://griot.pt",
  "https://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers = new Headers({
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "authorization,apikey,content-type,x-griot-workspace-id",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin || "https://griot.pt");
  }
  return headers;
}

function reply(req: Request, body: unknown, status: number) {
  const headers = cors(req);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return reply(req, { error: "Authentication required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  if (!supabaseUrl || !anonKey) {
    return reply(req, { error: "Supabase server configuration is incomplete" }, 503);
  }

  let input: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply(req, { error: "Invalid JSON body" }, 400);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return reply(req, { error: "Invalid JSON body" }, 400);
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/griot-gpu`, {
    method: "POST",
    headers: {
      authorization,
      apikey: req.headers.get("apikey") || anonKey,
      "content-type": "application/json",
      ...(req.headers.get("x-griot-workspace-id")
        ? { "x-griot-workspace-id": req.headers.get("x-griot-workspace-id")! }
        : {}),
    },
    body: JSON.stringify({ ...input, kernel: "griotgpu" }),
  });

  const body = await upstream.text();
  headers.set("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(body, { status: upstream.status, headers });
});
