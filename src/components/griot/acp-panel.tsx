import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ACP_CLIENTS } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { ChevronRight, Plug } from "lucide-react";

/**
 * Painel ACP: mostra os clientes ACP ligados ao GRIOT (ChatGPT, Claude,
 * Gemini, Copilot, Grok, Cursor, ...) — quem está conectado e quem não está.
 */
export function AcpPanel({
  connected,
  desktopOnline,
}: {
  connected: Record<string, boolean>;
  desktopOnline: boolean;
}) {
  const t = useT();
  const clients = useMemo(
    () => ACP_CLIENTS.map((client) => ({ ...client, on: connected[client.id] === true })),
    [connected],
  );
  const online = clients.filter((client) => client.on);

  return (
    <div className="panel overflow-hidden px-5 pt-4 pb-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            ACP
          </p>
          <p className="mt-1.5 text-[27px] leading-none font-semibold tracking-tight tabular-nums">
            {online.length}
            <span className="text-[15px] font-medium text-muted-foreground">
              {" "}
              / {clients.length}
            </span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {desktopOnline ? t("Host Desktop online") : t("Host Desktop offline")}
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
          <Plug className="size-[17px]" />
        </span>
      </div>

      <ul className="mt-3 divide-y divide-hairline">
        {clients.map((client) => (
          <li key={client.id} className="flex items-center gap-3 py-3">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[12.5px] font-semibold">
              {client.on ? (
                <span className="pulse-ring absolute inset-0 rounded-full bg-primary/25" />
              ) : null}
              {client.short}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium">{client.label}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {client.on ? `${t("Conectado")} · ${t(client.vendor)}` : t("Não ligado")}
              </span>
            </span>
            <span
              className={`size-2 shrink-0 rounded-full ${client.on ? "bg-primary" : "bg-muted-foreground/30"}`}
            />
          </li>
        ))}
      </ul>

      <Link
        to="/settings"
        className="-mx-5 mt-1 flex items-center justify-between border-t border-hairline px-5 py-3.5 text-[13.5px] font-medium"
      >
        {t("Gerir clientes ACP")}
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
