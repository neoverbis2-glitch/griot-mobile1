/* eslint-disable max-lines */
import { useState, useEffect, useMemo } from "react";
import { useT } from "@/lib/i18n";
import {
  ChevronLeft,
  Search,
  ExternalLink,
  Check,
  X,
  Sliders,
  Plug,
  Trash2,
  Key,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  PLUGINS_LIST,
  getConnectedPlugins,
  connectPlugin,
  disconnectPlugin,
  type PluginDefinition,
  type PluginCategory,
  type ConnectedPluginData,
} from "@/lib/plugins-service";
import * as BrandIcons from "@/components/griot/brand-icons";
import { toast } from "sonner";

interface PluginsViewProps {
  onBack: () => void;
}

export function PluginsView({ onBack }: PluginsViewProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory>("all");
  const [connectedMap, setConnectedMap] = useState<Record<string, ConnectedPluginData>>(() =>
    getConnectedPlugins(),
  );
  const [configuringPlugin, setConfiguringPlugin] = useState<PluginDefinition | null>(null);
  const [inputKey, setInputKey] = useState("");
  const [inputAccount, setInputAccount] = useState("");

  const refreshConnections = () => {
    setConnectedMap(getConnectedPlugins());
  };

  useEffect(() => {
    const handleUpdate = () => refreshConnections();
    window.addEventListener("griot-plugins-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("griot-plugins-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const connectedCount = useMemo(() => {
    return Object.values(connectedMap).filter((p) => p.connected).length;
  }, [connectedMap]);

  const filteredPlugins = useMemo(() => {
    return PLUGINS_LIST.filter((plugin) => {
      const matchCategory = selectedCategory === "all" || plugin.category === selectedCategory;
      const matchSearch =
        search.trim() === "" ||
        plugin.name.toLowerCase().includes(search.toLowerCase()) ||
        plugin.description.toLowerCase().includes(search.toLowerCase()) ||
        plugin.categoryLabel.toLowerCase().includes(search.toLowerCase());
      return matchCategory && matchSearch;
    });
  }, [selectedCategory, search]);

  const handleOpenConfig = (plugin: PluginDefinition) => {
    const existing = connectedMap[plugin.id];
    setInputKey(existing?.apiKey || "");
    setInputAccount(existing?.accountName || "");
    setConfiguringPlugin(plugin);
  };

  const handleSaveConnection = () => {
    if (!configuringPlugin) return;
    const key = inputKey.trim();
    if (!key && configuringPlugin.authType !== "oauth") {
      toast.error(t("Insere uma chave de API ou token válido."));
      return;
    }

    connectPlugin(configuringPlugin.id, {
      apiKey: key || "connected_oauth",
      accountName: inputAccount.trim() || undefined,
    });
    toast.success(t(`${configuringPlugin.name} ligado com sucesso.`));
    refreshConnections();
    setConfiguringPlugin(null);
  };

  const handleDisconnect = (plugin: PluginDefinition) => {
    disconnectPlugin(plugin.id);
    toast.success(t(`${plugin.name} desligado.`));
    refreshConnections();
  };

  const renderLogo = (logoName: string, className = "size-7") => {
    const Component = (BrandIcons as Record<string, React.ComponentType<{ className?: string }>>)[
      logoName
    ];
    if (Component) {
      return <Component className={className} />;
    }
    return <Plug className={className} />;
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground animate-fade-in pb-28">
      {/* Top Header */}
      <div className="sticky top-0 z-30 border-b border-hairline/80 bg-background/95 backdrop-blur-md px-4 pt-[calc(max(env(safe-area-inset-top,0px),24px)+0.5rem)] pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("Voltar às Definições")}
            className="grid size-9 place-items-center rounded-full border border-hairline bg-surface text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold tracking-tight">
              {t("Plugins e Integrações")}
            </h1>
            <p className="truncate text-[12px] text-muted-foreground">
              {connectedCount} {t("de")} {PLUGINS_LIST.length} {t("conectados")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11.5px] font-medium text-foreground">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span>{connectedCount} ativos</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Procurar plugins (GitHub, Supabase, Redis, Slack...)")}
            className="w-full rounded-2xl border border-hairline bg-surface py-2.5 pl-9 pr-9 text-[13.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Categories Tab Bar */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {(
            [
              { id: "all", label: t("Todos"), count: PLUGINS_LIST.length },
              { id: "dev_cloud", label: t("Dev & Cloud"), count: 8 },
              { id: "database", label: t("Bases de Dados"), count: 6 },
              { id: "productivity", label: t("Produtividade"), count: 11 },
              { id: "ai_tools", label: t("IA & Design"), count: 5 },
            ] as const
          ).map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface border border-hairline/70 text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat.label} <span className="opacity-70">({cat.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Plugins Grid */}
      <div className="p-4 space-y-3">
        {filteredPlugins.length === 0 ? (
          <div className="rounded-2xl border border-hairline/80 bg-surface/50 p-8 text-center my-6">
            <Search className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-2 text-[14px] font-medium">{t("Nenhum plugin encontrado")}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t("Tenta outro termo de pesquisa ou muda de categoria.")}
            </p>
          </div>
        ) : (
          filteredPlugins.map((plugin) => {
            const isConn = Boolean(connectedMap[plugin.id]?.connected);
            const connData = connectedMap[plugin.id];

            return (
              <div
                key={plugin.id}
                className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-200 ${
                  isConn
                    ? "border-emerald-500/30 bg-surface shadow-[0_2px_12px_rgba(16,185,129,0.04)]"
                    : "border-hairline bg-surface/60 hover:bg-surface"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* Real SVG Logo in polished circular avatar */}
                  <div className="relative grid size-12 shrink-0 place-items-center rounded-2xl border border-hairline bg-background shadow-xs">
                    {renderLogo(plugin.logoName, "size-6")}
                    {isConn && (
                      <span className="absolute -top-1 -right-1 size-3 rounded-full bg-emerald-500 ring-2 ring-background shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-semibold text-foreground">
                        {plugin.name}
                      </h3>
                      <span className="rounded-md bg-secondary/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {plugin.categoryLabel}
                      </span>
                    </div>

                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground line-clamp-2">
                      {plugin.description}
                    </p>

                    {/* Status hint if connected */}
                    {isConn && (
                      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="size-3.5" />
                        <span>{t("Conectado")}</span>
                        {connData?.secretHint && (
                          <span className="text-muted-foreground/70 font-mono text-[11px]">
                            ({connData.secretHint})
                          </span>
                        )}
                        {connData?.accountName && (
                          <span className="text-muted-foreground/70">· {connData.accountName}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isConn ? (
                      <>
                        <button
                          onClick={() => handleOpenConfig(plugin)}
                          className="grid size-8 place-items-center rounded-full border border-hairline text-foreground/80 hover:bg-secondary active:scale-95"
                          title={t("Configurar")}
                        >
                          <Sliders className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDisconnect(plugin)}
                          className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95"
                          title={t("Desligar")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleOpenConfig(plugin)}
                        className="rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground shadow-xs transition-transform active:scale-95"
                      >
                        {t("Ligar")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Conexão e Configuração do Plugin */}
      {configuringPlugin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-hairline bg-card p-5 shadow-2xl rise">
            <div className="flex items-center justify-between border-b border-hairline pb-3.5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-2xl border border-hairline bg-surface">
                  {renderLogo(configuringPlugin.logoName, "size-5")}
                </div>
                <div>
                  <h3 className="text-[16px] font-semibold text-foreground">
                    {configuringPlugin.name}
                  </h3>
                  <p className="text-[12px] text-muted-foreground">
                    {configuringPlugin.categoryLabel}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfiguringPlugin(null)}
                className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {configuringPlugin.description}
              </p>

              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1.5">
                  {configuringPlugin.authType === "webhook"
                    ? t("Webhook URL")
                    : t("Chave de API / Token de Acesso")}
                </label>
                <input
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder={configuringPlugin.placeholder}
                  className="w-full rounded-2xl border border-hairline bg-surface px-3.5 py-2.5 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground font-mono"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1.5">
                  {t("Identificador da Conta ou Workspace (Opcional)")}
                </label>
                <input
                  type="text"
                  value={inputAccount}
                  onChange={(e) => setInputAccount(e.target.value)}
                  placeholder={t("Ex.: org-principal, equipa-dev")}
                  className="w-full rounded-2xl border border-hairline bg-surface px-3.5 py-2.5 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground"
                />
              </div>

              {configuringPlugin.docsUrl && (
                <a
                  href={configuringPlugin.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-4"
                >
                  <ExternalLink className="size-3" />
                  <span>
                    {t("Onde obter credenciais do")} {configuringPlugin.name}
                  </span>
                </a>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-hairline pt-3.5">
              <button
                onClick={() => setConfiguringPlugin(null)}
                className="rounded-full px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                {t("Cancelar")}
              </button>
              <button
                onClick={handleSaveConnection}
                className="rounded-full bg-primary px-5 py-2 text-[13px] font-medium text-primary-foreground shadow-xs transition-transform active:scale-95"
              >
                {t("Guardar e Ligar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
