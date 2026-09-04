import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Screen, Panel, Empty } from "@/components/griot/screen";
import { UsageSection, DailyPulse, type RunRow, type ServiceRow } from "@/components/griot/usage";
import { ApiBudgetPanel } from "@/components/griot/api-budget";
import { ApisPanel } from "@/components/griot/acp-panel";
import { useT } from "@/lib/i18n";
import { greeting, relativeTime } from "@/lib/griot";
import { useTheme } from "@/lib/theme";
import { UserAvatar } from "@/components/griot/user-avatar";
import { useCurrentUser } from "@/hooks/use-user";
import { Moon, Sun, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Home — GRIOT Mobile" },
      {
        name: "description",
        content:
          "Consumo de GCU, uso diário e semanal, projeto ativo e agentes — o teu ecossistema num só ecrã.",
      },
      { property: "og:title", content: "Home — GRIOT Mobile" },
      { property: "og:description", content: "Consumo de GCU, uso diário e semanal, num só ecrã." },
    ],
  }),
  component: HomePage,
});

const BUILD_LABEL_SOURCE: Record<string, string> = {
  success: "Concluído",
  running: "A correr",
  failed: "Falhou",
  idle: "Em espera",
};

function HomePage() {
  const { theme, toggle } = useTheme();
  const t = useT();
  const { displayName, email, avatarUrl } = useCurrentUser();

  const { data } = useQuery({
    queryKey: ["home", email, displayName],
    queryFn: async () => {
      try {
        const since = new Date(Date.now() - 31 * 86_400_000).toISOString();
        const { data: authData } = await supabase.auth.getUser();
        const currentUser = authData?.user ?? null;

        const profilePromise = currentUser
          ? supabase
              .from("profiles")
              .select("display_name, active_project_id, desktop_online, avatar_url")
              .eq("id", currentUser.id)
              .maybeSingle()
          : supabase
              .from("profiles")
              .select("display_name, active_project_id, desktop_online, avatar_url")
              .maybeSingle();

        const [profile, projects, agents, alerts, runs, services] = await Promise.all([
          profilePromise,
          supabase
            .from("projects")
            .select("*")
            .eq("archived", false)
            .order("updated_at", { ascending: false }),
          supabase.from("agents").select("id, status"),
          supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(1),
          supabase
            .from("runs")
            .select("created_at, cost_usd, duration_ms")
            .gte("created_at", since)
            .order("created_at"),
          supabase.from("services").select("name, kind, status, cost_usd, usage_units"),
        ]);

        const localName =
          typeof window !== "undefined" ? localStorage.getItem("griot_user_name") : null;
        const localEmail =
          typeof window !== "undefined" ? localStorage.getItem("griot_user_email") : null;

        const resolvedName =
          profile.data?.display_name ||
          currentUser?.user_metadata?.display_name ||
          currentUser?.user_metadata?.name ||
          currentUser?.user_metadata?.full_name ||
          displayName ||
          localName ||
          (currentUser?.email ? currentUser.email.split("@")[0] : null) ||
          (localEmail ? localEmail.split("@")[0] : null) ||
          (email ? email.split("@")[0] : "");

        const resolvedAvatar =
          profile.data?.avatar_url ||
          currentUser?.user_metadata?.avatar_url ||
          currentUser?.user_metadata?.picture ||
          avatarUrl ||
          (typeof window !== "undefined" ? localStorage.getItem("griot_user_avatar") : null);

        return {
          profile: profile.data
            ? {
                ...profile.data,
                display_name: resolvedName,
                avatar_url: resolvedAvatar,
              }
            : {
                display_name: resolvedName,
                active_project_id: null,
                desktop_online: false,
                avatar_url: resolvedAvatar,
              },
          projects: projects.data ?? [],
          activeAgents: (agents.data ?? []).filter((agent) => agent.status === "active").length,
          alert: alerts.data?.[0] ?? null,
          runs: (runs.data ?? []) as RunRow[],
          services: (services.data ?? []) as ServiceRow[],
        };
      } catch (err) {
        console.warn("Falha na consulta da Home, usando estado inicial de fallback:", err);
        return {
          profile: {
            display_name: displayName || "GRIOT",
            active_project_id: "p1",
            desktop_online: false,
            avatar_url: avatarUrl || null,
          },
          projects: [
            {
              id: "p1",
              user_id: "anonymous",
              name: "Neoverbis",
              description: "Plataforma editorial e de tradução assistida.",
              progress: 92,
              build_status: "success",
              archived: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            {
              id: "p2",
              user_id: "anonymous",
              name: "ModelOS",
              description: "Camada de orquestração de modelos do GRIOT.",
              progress: 47,
              build_status: "running",
              archived: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          activeAgents: 2,
          alert: null,
          runs: [] as RunRow[],
          services: [] as ServiceRow[],
        };
      }
    },
  });

  const active =
    data?.projects.find((project) => project.id === data.profile?.active_project_id) ??
    data?.projects[0];

  const headerTitle =
    data?.profile?.display_name ||
    displayName ||
    (typeof window !== "undefined" ? localStorage.getItem("griot_user_name") : null) ||
    (email ? email.split("@")[0] : "") ||
    "";

  return (
    <Screen
      subtitle={t(greeting())}
      icon={
        <UserAvatar
          name={headerTitle}
          email={email}
          avatarUrl={avatarUrl || (data?.profile as unknown as { avatar_url?: string })?.avatar_url}
          size="sm"
        />
      }
      title={headerTitle}
      action={
        <button
          onClick={toggle}
          aria-label={t("Alternar tema")}
          className="grid size-10 place-items-center rounded-full border border-hairline bg-surface transition-transform duration-200 active:scale-95"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      }
    >
      <DailyPulse runs={data?.runs ?? []} />

      <ApiBudgetPanel services={data?.services ?? []} />

      <ApisPanel />

      <UsageSection runs={data?.runs ?? []} services={data?.services ?? []} />

      {active ? (
        <Link to="/projects/$projectId" params={{ projectId: active.id }} className="block">
          <Panel>
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {t("Projeto ativo")}
            </p>
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate text-[26px] leading-none font-semibold tracking-tight">
                {active.name}
              </span>
              <span className="text-[20px] font-semibold tabular-nums">{active.progress}%</span>
            </div>
            <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${active.progress}%` }}
              />
            </div>
          </Panel>
        </Link>
      ) : (
        <Empty text={t("Ainda não existe nenhum projeto.")} />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Panel>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {t("Agentes")}
          </p>
          <p className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight">
            {data?.activeAgents ?? 0}
          </p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{t("ativos")}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {t("Build")}
          </p>
          <p className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight">
            {t(BUILD_LABEL_SOURCE[String(active?.build_status ?? "idle")] ?? "Em espera")}
          </p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {data?.profile?.desktop_online ? t("Desktop online") : t("Desktop offline")}
          </p>
        </Panel>
      </div>

      {data?.alert ? (
        <Panel>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {t("Último alerta")}
          </p>
          <p className="mt-1.5 text-[17px] font-medium">{data.alert.message}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {relativeTime(data.alert.created_at)}
          </p>
        </Panel>
      ) : null}

      <Link to="/chat" className="block">
        <Panel className="flex items-center justify-between">
          <span className="text-[16px] font-medium">{t("Continuar a conversa")}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Panel>
      </Link>
    </Screen>
  );
}
