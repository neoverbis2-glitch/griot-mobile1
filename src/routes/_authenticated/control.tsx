import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Screen, Panel, Metric, Empty } from "@/components/griot/screen";
import { RuntimeObserverCard } from "@/components/griot/runtime-panel";
import { relativeTime } from "@/lib/griot";
import { useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/control")({
  head: () => ({
    meta: [
      { title: "Control Center — GRIOT Mobile" },
      {
        name: "description",
        content: "ModelOS: estado das APIs, modelos, utilização, custos, agentes e execuções.",
      },
      { property: "og:title", content: "Control Center — GRIOT Mobile" },
      {
        property: "og:description",
        content: "ModelOS: estado dos modelos, custos, agentes e execuções.",
      },
    ],
  }),
  component: ControlPage,
});

const STATUS_LABEL: Record<string, string> = {
  operational: "Operacional",
  degraded: "Degradado",
  down: "Em baixo",
};

function ControlPage() {
  const t = useT();
  const { theme, toggle } = useTheme();

  const { data } = useQuery({
    queryKey: ["control"],
    queryFn: async () => {
      const [services, agents, runs, profile] = await Promise.all([
        supabase.from("services").select("*").order("name"),
        supabase.from("agents").select("*").order("created_at"),
        supabase.from("runs").select("*").order("created_at", { ascending: false }).limit(8),
        supabase.from("profiles").select("desktop_online, display_name").maybeSingle(),
      ]);
      return {
        services: services.data ?? [],
        agents: agents.data ?? [],
        runs: runs.data ?? [],
        profile: profile.data,
      };
    },
  });

  const cost = (data?.services ?? []).reduce(
    (total, service) => total + Number(service.cost_usd ?? 0),
    0,
  );
  const activeAgents = (data?.agents ?? []).filter((agent) => agent.status === "active").length;

  return (
    <Screen
      title={t("Control")}
      subtitle="ModelOS"
      action={
        <Link
          to="/settings"
          aria-label={t("Definições")}
          className="grid size-10 place-items-center rounded-full border border-hairline"
        >
          <Settings className="size-[18px]" />
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Metric label={t("Custo")} value={`$${cost.toFixed(2)}`} note={t("acumulado")} />
        <Metric label={t("Agentes")} value={`${activeAgents}`} note={t("ativos")} />
      </div>

      <RuntimeObserverCard />

      <Panel className="flex items-center justify-between">
        <div>
          <p className="text-[15.5px] font-medium">{t("Desktop")}</p>
          <p className="text-[13px] text-muted-foreground">
            {data?.profile?.desktop_online ? t("Online") : t("Offline")}
          </p>
        </div>
        <span
          className={`size-2.5 rounded-full ${data?.profile?.desktop_online ? "bg-primary" : "bg-muted-foreground/40"}`}
        />
      </Panel>

      <p className="pt-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("Serviços")}
      </p>
      {data?.services.length ? (
        <Panel className="divide-y divide-hairline">
          {data.services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{service.name}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {t(STATUS_LABEL[service.status] ?? service.status)} · $
                  {Number(service.cost_usd ?? 0).toFixed(2)}
                </p>
              </div>
              <span
                className={`size-2 shrink-0 rounded-full ${
                  service.status === "operational" ? "bg-primary" : "bg-muted-foreground/50"
                }`}
              />
            </div>
          ))}
        </Panel>
      ) : (
        <Empty text={t("Sem serviços registados.")} />
      )}

      <p className="pt-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("Execuções")}
      </p>
      {data?.runs.length ? (
        <Panel className="divide-y divide-hairline">
          {data.runs.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{run.label}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {relativeTime(run.created_at)}
                </p>
              </div>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">{run.status}</span>
            </div>
          ))}
        </Panel>
      ) : (
        <Empty text={t("Sem execuções recentes.")} />
      )}

      <div className="grid grid-cols-2 gap-2.5 pt-2">
        <button
          onClick={toggle}
          className="rounded-2xl border border-hairline py-3.5 text-[15px] font-medium transition-transform duration-200 active:scale-95"
        >
          {t("Tema")} {theme === "dark" ? t("claro") : t("escuro")}
        </button>
        <Link
          to="/neoverbis-pay"
          className="rounded-2xl border border-hairline py-3.5 text-center text-[15px] font-medium transition-transform duration-200 active:scale-95"
        >
          {t("Planos & Preços")}
        </Link>
      </div>
    </Screen>
  );
}
