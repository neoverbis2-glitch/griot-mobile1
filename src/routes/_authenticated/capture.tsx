import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Screen, Panel, Empty } from "@/components/griot/screen";
import { CAPTURE_KINDS, relativeTime, type CaptureKind } from "@/lib/griot";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { useT } from "@/lib/i18n";
import { CaptureDetail } from "@/components/griot/capture-detail";
import type { CaptureRow } from "@/lib/capture-share";
import { uploadToStorageBucket, STORAGE_BUCKETS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({
    meta: [
      { title: "Capture — GRIOT Mobile" },
      {
        name: "description",
        content:
          "Foto, vídeo, documento, áudio, texto ou localização — tudo entra no projeto certo.",
      },
      { property: "og:title", content: "Capture — GRIOT Mobile" },
      {
        property: "og:description",
        content: "Captura qualquer coisa e envia para o projeto certo.",
      },
    ],
  }),
  component: CapturePage,
});

function CapturePage() {
  const t = useT();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<CaptureKind | null>(null);
  const [detail, setDetail] = useState<CaptureRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<CaptureKind>("photo");

  const { data } = useQuery({
    queryKey: ["captures"],
    queryFn: async () => {
      const [captures, projects] = await Promise.all([
        supabase.from("captures").select("*").order("created_at", { ascending: false }).limit(20),
        supabase
          .from("projects")
          .select("id, name")
          .eq("archived", false)
          .order("updated_at", { ascending: false }),
      ]);
      return { captures: captures.data ?? [], projects: projects.data ?? [] };
    },
  });

  const targetProject = data?.projects[0]?.id ?? null;

  async function record(
    kind: CaptureKind,
    payload: Partial<{
      storage_path: string;
      mime_type: string;
      latitude: number;
      longitude: number;
    }>,
  ) {
    const { error } = await supabase.from("captures").insert({
      user_id: user.id,
      project_id: targetProject,
      kind,
      note: note.trim() || null,
      ...payload,
    });
    if (error) {
      toast.error(t("Não foi possível guardar a captura."));
      return;
    }
    setNote("");
    setSheet(false);
    toast.success(t("Captura enviada para o projeto."));
    await queryClient.invalidateQueries({ queryKey: ["captures"] });
  }

  async function upload(file: File, kind: CaptureKind) {
    setPending(kind);
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
    const { url, error } = await uploadToStorageBucket(STORAGE_BUCKETS.CAPTURES, path, file, {
      contentType: file.type,
      upsert: true,
    });
    setPending(null);
    if (error && !url) {
      toast.error(t("Falha no envio do ficheiro para o bucket."));
      return;
    }
    await record(kind, { storage_path: url || path, mime_type: file.type });
  }

  function pick(kind: CaptureKind) {
    kindRef.current = kind;
    const input = inputRef.current;
    if (!input) return;
    input.accept =
      kind === "photo"
        ? "image/*"
        : kind === "video"
          ? "video/*"
          : kind === "audio"
            ? "audio/*"
            : "*/*";
    if (kind === "photo" || kind === "video") input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  }

  function locate() {
    if (!navigator.geolocation) {
      toast.error(t("Localização indisponível neste dispositivo."));
      return;
    }
    setPending("location");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPending(null);
        void record("location", {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        setPending(null);
        toast.error(t("Não foi possível obter a localização."));
      },
    );
  }

  function handleKind(kind: CaptureKind) {
    if (kind === "location") return locate();
    if (kind === "text") {
      if (!note.trim()) {
        toast.error(t("Escreve alguma coisa primeiro."));
        return;
      }
      return void record("text", {});
    }
    if (kind === "screen") {
      toast(t("Captura de ecrã: usa Foto para enviar a imagem do ecrã."));
      return;
    }
    pick(kind);
  }

  return (
    <Screen title={t("Capture")} subtitle={t("O mundo físico entra aqui")}>
      <button
        onClick={() => setSheet(true)}
        className="panel grid aspect-square w-full place-items-center transition-transform duration-200 active:scale-[0.98]"
      >
        <div className="text-center">
          <div className="mx-auto grid size-24 place-items-center rounded-full bg-primary text-primary-foreground">
            <Camera className="size-9" />
          </div>
          <p className="mt-6 text-[22px] font-semibold tracking-tight">{t("Capturar")}</p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {data?.projects[0]?.name
              ? `${t("Vai para")} ${data.projects[0].name}`
              : t("Sem projeto ativo")}
          </p>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file, kindRef.current);
          event.target.value = "";
        }}
      />

      <p className="pt-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("Recentes")}
      </p>
      {data?.captures.length ? (
        <Panel className="divide-y divide-hairline">
          {data.captures.map((capture) => (
            <button
              key={capture.id}
              onClick={() => setDetail(capture as CaptureRow)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left transition-opacity duration-200 first:pt-0 last:pb-0 active:opacity-60"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">
                  {capture.note ?? t(CAPTURE_KINDS.find((k) => k.id === capture.kind)?.label ?? "")}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {relativeTime(capture.created_at)}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-muted-foreground">
                {t(CAPTURE_KINDS.find((k) => k.id === capture.kind)?.label ?? "")}
              </span>
            </button>
          ))}
        </Panel>
      ) : (
        <Empty text={t("Ainda não capturaste nada.")} />
      )}

      {detail ? (
        <CaptureDetail capture={detail} userId={user.id} onClose={() => setDetail(null)} />
      ) : null}

      {sheet ? (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="sheet-up relative w-full rounded-t-[28px] border-t border-hairline bg-surface px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-muted" />
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("Nota ou contexto (opcional)")}
              className="mt-5 w-full resize-none rounded-2xl border border-hairline bg-background px-4 py-3 text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {CAPTURE_KINDS.map((kind) => (
                <button
                  key={kind.id}
                  onClick={() => handleKind(kind.id)}
                  disabled={pending !== null}
                  className="rounded-2xl border border-hairline py-3.5 text-[15px] font-medium transition-transform duration-200 active:scale-95 disabled:opacity-40"
                >
                  {pending === kind.id ? t("A enviar…") : t(kind.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}
