import { supabase } from "@/integrations/supabase/client";

export type CaptureRow = {
  id: string;
  kind: string;
  note: string | null;
  storage_path: string | null;
  mime_type: string | null;
  latitude: number | null;
  longitude: number | null;
  project_id: string | null;
  created_at: string;
};

/** Data e hora exatas, para a barra de detalhe do Capture. */
export function exactDateTime(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export async function captureUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path;
  }
  try {
    const { data } = await supabase.storage.from("captures").createSignedUrl(path, 3600);
    if (data?.signedUrl) return data.signedUrl;
    const { data: publicUrlData } = supabase.storage.from("captures").getPublicUrl(path);
    return publicUrlData?.publicUrl ?? null;
  } catch {
    return null;
  }
}

export function captureTitle(capture: CaptureRow) {
  if (capture.note?.trim()) return capture.note.trim();
  if (capture.kind === "location" && capture.latitude != null && capture.longitude != null) {
    return `${capture.latitude.toFixed(5)}, ${capture.longitude.toFixed(5)}`;
  }
  if (capture.storage_path) return capture.storage_path.split("/").pop() ?? capture.kind;
  return capture.kind;
}

/** Texto que representa a captura quando é enviada para uma conversa. */
export async function captureAsText(capture: CaptureRow) {
  const lines = [`Capture (${capture.kind}) — ${exactDateTime(capture.created_at)}`];
  if (capture.note?.trim()) lines.push(capture.note.trim());
  if (capture.latitude != null && capture.longitude != null) {
    lines.push(`Localização: ${capture.latitude}, ${capture.longitude}`);
  }
  const url = await captureUrl(capture.storage_path);
  if (url) lines.push(url);
  return lines.join("\n");
}

/** Envia para uma conversa: usa a mais recente ou cria uma nova. */
export async function sendCaptureToConversation(capture: CaptureRow, userId: string) {
  const { data: existing } = await (supabase as any)
    .from("griot_conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);

  let conversationId = existing?.[0]?.id ?? null;
  if (!conversationId) {
    const { data: created } = await (supabase as any)
      .from("griot_conversations")
      .insert({
        owner_id: userId,
        created_by: userId,
        title: "Captura",
      })
      .select("id")
      .single();
    conversationId = created?.id ?? null;
  }
  if (!conversationId) throw new Error("no conversation");

  const content = await captureAsText(capture);
  const { error } = await (supabase as any).from("griot_messages").insert({
    conversation_id: conversationId,
    actor_kind: "human",
    content,
    status: "succeeded",
  });
  if (error) throw error;
  return conversationId;
}

/** Envia para o Control Center como registo. */
export async function sendCaptureToControl(capture: CaptureRow, userId: string) {
  const { error } = await supabase.from("logs").insert({
    user_id: userId,
    project_id: capture.project_id,
    level: "info",
    source: "capture",
    message: `${captureTitle(capture)} · ${exactDateTime(capture.created_at)}`,
  });
  if (error) throw error;
}

const QUICK_KEY = "griot-quick-captures";

export function listQuickCaptures(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUICK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Marca a captura como rápida (aparece no “+” do chat). */
export function pushQuickCapture(id: string) {
  if (typeof window === "undefined") return;
  const next = [id, ...listQuickCaptures().filter((item) => item !== id)].slice(0, 12);
  window.localStorage.setItem(QUICK_KEY, JSON.stringify(next));
}
