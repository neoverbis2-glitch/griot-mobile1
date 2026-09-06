import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Screen } from "@/components/griot/screen";
import { UserAvatar } from "@/components/griot/user-avatar";
import { useCurrentUser } from "@/hooks/use-user";
import { SettingsGroup, ToggleRow, SelectRow, InfoRow, ActionRow } from "@/components/griot/settings-kit";
import { useTheme } from "@/lib/theme";
import { DEFAULT_MODEL, getAvailableModels, modelLabel, isModelOS } from "@/lib/griot";
import { uploadUserAvatar, getLocalCacheStats } from "@/lib/storage";
import { APP_LANGUAGES, loadPrefs, savePrefs, type Prefs } from "@/lib/settings";
import { listGriotCredentials, saveGriotCredential, verifyGriotCredential } from "@/lib/griot-api";
import { saveUserApi } from "@/lib/user-apis";
import { resolveSpeechLanguage } from "@/lib/speech-transcriber";
import { useI18n, useT, labelFromLocale, localeFromLabel } from "@/lib/i18n";
import { toast } from "sonner";
import {
  requestRealCameraPermission,
  requestRealMicrophonePermission,
  requestRealLocationPermission,
  verifyRealBiometrics,
  clearAllLocalData,
} from "@/lib/permissions";
import { testSystemNotification } from "@/lib/notifications";
import { requestAllNativePermissions } from "@/lib/native-notifications";
import { VoiceTestModal } from "@/components/griot/voice-test-modal";
import { TermsDialog } from "@/components/griot/terms-dialog";
import { PluginsView } from "@/components/griot/plugins-view";
import { countConnectedPlugins } from "@/lib/plugins-service";
import { ChevronLeft, LogOut, Sparkle, Upload, Key, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Definições — GRIOT Mobile" },
      {
        name: "description",
        content: "Centro de comando do GRIOT Mobile: Conta, Modelos, Voz, Permissões, Aparência e Sistema.",
      },
    ],
  }),
  component: SettingsPage,
});

const MODEL_KEY = "griot-default-model";
const LANGUAGE_LABELS = APP_LANGUAGES.map((language) => language.label);
const ANSWER_LANGUAGES = ["Automático", ...LANGUAGE_LABELS];

function SettingsPage() {
  const { user, email: userEmail, displayName, avatarUrl } = useCurrentUser();
  const [activeUser, setActiveUser] = useState(user);
  const { theme, toggle } = useTheme();
  const t = useT();
  const { locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(displayName || "");
  const [saving, setSaving] = useState(false);
  const [showApiKeyBox, setShowApiKeyBox] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [savingGeminiKey, setSavingGeminiKey] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [cacheStats, setCacheStats] = useState(() => getLocalCacheStats());
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testModalMode, setTestModalMode] = useState<"voice" | "mic" | "camera">("voice");
  const [showTerms, setShowTerms] = useState(false);
  const [pluginsViewOpen, setPluginsViewOpen] = useState(false);
  const [connectedPluginsCount, setConnectedPluginsCount] = useState(() => countConnectedPlugins());
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateCount = () => setConnectedPluginsCount(countConnectedPlugins());
    window.addEventListener("griot-plugins-updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      window.removeEventListener("griot-plugins-updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, []);

  useEffect(() => {
    if (displayName) setName(displayName);
  }, [displayName]);

  const availableModels = useMemo(() => getAvailableModels(prefs), [prefs]);
  const modelLabels = useMemo(() => availableModels.map((m) => m.label), [availableModels]);

  const currentAppLang = (prefs.appLanguage || prefs.voiceLanguage || labelFromLocale(locale) || "Português (Portugal)") as string;
  const langInfo = useMemo(() => resolveSpeechLanguage(currentAppLang), [currentAppLang]);
  const [deviceVoices, setDeviceVoices] = useState<string[]>([]);

  useEffect(() => {
    function updateVoices() {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const all = window.speechSynthesis.getVoices();
      const matching = all
        .filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(langInfo.code))
        .map((v) => v.name);
      setDeviceVoices(matching);
    }
    updateVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [langInfo.code]);

  const voiceOptions = useMemo(() => {
    const baseTones =
      langInfo.code === "pt"
        ? ["GRIOT Nativa (Português)", "Serena (pt)", "Grave (pt)", "Neutra (pt)"]
        : langInfo.code === "en"
        ? ["GRIOT Native (English)", "Serene (en)", "Deep (en)", "Neutral (en)"]
        : langInfo.code === "es"
        ? ["GRIOT Nativo (Español)", "Serena (es)", "Grave (es)", "Neutra (es)"]
        : [
            `GRIOT Nativa (${langInfo.name})`,
            `Serena (${langInfo.code})`,
            `Grave (${langInfo.code})`,
            `Neutra (${langInfo.code})`,
          ];

    const filteredDevice = deviceVoices.filter((v) => !baseTones.includes(v));
    return [...baseTones, ...filteredDevice];
  }, [langInfo.code, langInfo.name, deviceVoices]);

  useEffect(() => {
    const stored = window.localStorage.getItem(MODEL_KEY);
    if (stored) setDefaultModel(stored);
    setPrefs(loadPrefs());
    setCacheStats(getLocalCacheStats());

    void supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setActiveUser(data.user);
        const metaName = data.user.user_metadata?.display_name || data.user.user_metadata?.name;
        if (metaName) setName(metaName);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const textSize = prefs.textSize || "Padrão";
    if (textSize === "Compacto") {
      document.documentElement.setAttribute("data-text-size", "compact");
    } else if (textSize === "Grande") {
      document.documentElement.setAttribute("data-text-size", "large");
    } else {
      document.documentElement.removeAttribute("data-text-size");
    }

    if (prefs.reduceMotion) {
      document.documentElement.classList.add("reduce-motion");
    } else {
      document.documentElement.classList.remove("reduce-motion");
    }
  }, [prefs.textSize, prefs.reduceMotion]);

  const { data: status } = useQuery({
    queryKey: ["settings-status", activeUser?.id],
    queryFn: async () => {
      if (!activeUser?.id) return { spent: 0, wallet: null };
      const workspaceId = await (supabase as any)
        .from("griot_workspace_members")
        .select("workspace_id")
        .eq("user_id", activeUser.id)
        .maybeSingle()
        .then((res: any) => res.data?.workspace_id);
      if (!workspaceId) return { spent: 0, wallet: null };

      const wallet = await (supabase as any)
        .from("griot_gcu_wallets")
        .select("balance_gcu, lifetime_used_gcu")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      return {
        spent: Number(wallet.data?.lifetime_used_gcu ?? 0),
        wallet: wallet.data ?? null,
      };
    },
    enabled: Boolean(activeUser?.id),
  });

  const { data: geminiCredential } = useQuery({
    queryKey: ["settings-gemini-credential", activeUser?.id],
    queryFn: async () => {
      const result = await listGriotCredentials("provider");
      const rows = result.data?.credentials ?? [];
      return rows.find((row) => row.providerId === "gemini") ?? null;
    },
    enabled: Boolean(activeUser?.id),
  });

  async function saveAndVerifyGeminiKey() {
    const secret = geminiKeyInput.trim();
    if (!secret) return;
    setSavingGeminiKey(true);
    try {
      if (typeof window !== "undefined") {
        void saveUserApi({ providerId: "gemini", apiKey: secret, label: "Google Gemini" });
      }
      const saved = await saveGriotCredential({ providerId: "gemini", secret, label: "Gemini" });
      if (saved.error || !saved.data) {
        toast.error(saved.error || t("Não foi possível guardar a chave."));
        return;
      }
      const verified = await verifyGriotCredential(saved.data.credential.id);
      if (verified.error || !verified.data?.valid) {
        toast.error(verified.data?.message || verified.error || t("Chave inválida."));
      } else {
        toast.success(t("Chave ligada e verificada com sucesso!"));
        setGeminiKeyInput("");
        setShowApiKeyBox(false);
      }
      await queryClient.invalidateQueries({ queryKey: ["settings-gemini-credential"] });
      if (typeof window !== "undefined") window.dispatchEvent(new Event("griot-apis-updated"));
    } finally {
      setSavingGeminiKey(false);
    }
  }

  function set(key: string, value: string | boolean) {
    setPrefs((current) => {
      const next = { ...current, [key]: value };
      savePrefs(next);
      return next;
    });
  }

  const bool = (key: string) => Boolean(prefs[key]);
  const text = (key: string) => String(prefs[key] ?? "—");

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const currentUserId = activeUser?.id || "anonymous";
    setUploadingAvatar(true);
    const { error } = await uploadUserAvatar(currentUserId, file);
    setUploadingAvatar(false);
    if (error) {
      toast.error(t("Erro ao enviar foto para o bucket."));
    } else {
      toast.success(t("Foto de perfil atualizada no bucket."));
      await queryClient.invalidateQueries({ queryKey: ["settings-status"] });
    }
  }

  async function saveProfile() {
    setSaving(true);
    const trimmedName = name.trim();
    if (activeUser?.id) {
      await supabase.auth.updateUser({ data: { display_name: trimmedName } });
    }
    setSaving(false);
    toast.success(t("Perfil guardado."));
  }

  async function signOut() {
    await supabase.auth.signOut();
    void navigate({ to: "/auth" });
  }

  const modelName =
    availableModels.find((model) => model.id === defaultModel)?.label ??
    (isModelOS(defaultModel) ? "ModelOS" : modelLabel(defaultModel));

  const remainingGcu =
    status?.wallet?.balance_gcu != null
      ? `${Number(status.wallet.balance_gcu).toFixed(0)} GCU`
      : "0 GCU";

  if (pluginsViewOpen) {
    return <PluginsView onBack={() => setPluginsViewOpen(false)} />;
  }

  return (
    <Screen
      title={t("Definições")}
      subtitle={t("Centro de comando")}
      action={
        <Link
          to="/control"
          aria-label={t("Voltar")}
          className="grid size-10 place-items-center rounded-full border border-hairline hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="size-[18px]" />
        </Link>
      }
    >
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarChange}
      />

      <div className="space-y-6 pb-12">
        <SettingsGroup title="Conta & Subscrição" note="Perfil, saldo de computação e chaves de IA">
          <div className="flex items-center justify-between gap-4 p-4 border-b border-hairline">
            <div className="flex items-center gap-3.5 min-w-0">
              <UserAvatar
                name={name || displayName || userEmail?.split("@")[0]}
                email={userEmail}
                avatarUrl={avatarUrl}
                size="lg"
                className="rounded-2xl shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-foreground">
                  {name || displayName || userEmail?.split("@")[0] || t("Utilizador")}
                </p>
                <p className="truncate text-[12.5px] text-muted-foreground">
                  {userEmail || t("Sessão ativa")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="shrink-0 flex items-center gap-1.5 rounded-full border border-hairline bg-secondary/50 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary active:scale-95 transition-all"
            >
              <Upload className="size-3.5" />
              {uploadingAvatar ? t("A enviar…") : t("Foto")}
            </button>
          </div>

          <div className="border-b border-hairline p-4 space-y-2">
            <label className="block text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
              {t("Nome de exibição")}
            </label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("O teu nome")}
                className="flex-1 rounded-xl border border-hairline bg-background px-3.5 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={saving}
                className="shrink-0 rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
              >
                {saving ? t("A guardar…") : t("Guardar")}
              </button>
            </div>
          </div>

          <InfoRow label="Saldo em carteira" value={remainingGcu} hint="Computação GCU disponível para uso" />
          <ActionRow
            label="Gerir Plano & Recarga"
            hint="Ver planos e adquirir créditos de GCU"
            onClick={() => void navigate({ to: "/neoverbis-pay" })}
          />
          <ActionRow
            label="Chave Google Gemini"
            hint={
              geminiCredential?.status === "active"
                ? `${t("Chave ativa")}: ${geminiCredential.secretHint}`
                : t("Adiciona a tua chave para conversar de verdade")
            }
            value={geminiCredential?.status === "active" ? "Ligada" : "Pendente"}
            onClick={() => setShowApiKeyBox(!showApiKeyBox)}
          />

          {showApiKeyBox ? (
            <div className="p-4 border-b border-hairline bg-secondary/20 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                  <Key className="size-3.5 text-primary" /> {t("Configurar Chave Gemini")}
                </span>
                <button
                  onClick={() => setShowApiKeyBox(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <input
                value={geminiKeyInput}
                onChange={(event) => setGeminiKeyInput(event.target.value)}
                placeholder={t("Colar chave da API (ex.: AIza…)")}
                className="w-full rounded-xl border border-hairline bg-background px-3.5 py-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground font-mono"
                type="password"
                autoCapitalize="none"
              />
              <div className="flex items-center justify-between gap-3">
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-primary hover:underline"
                >
                  {t("Obter chave gratuita ↗")}
                </a>
                <button
                  type="button"
                  onClick={() => void saveAndVerifyGeminiKey()}
                  disabled={savingGeminiKey || !geminiKeyInput.trim()}
                  className="rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground active:scale-95 disabled:opacity-40"
                >
                  {savingGeminiKey ? t("A verificar…") : t("Guardar e Verificar")}
                </button>
              </div>
            </div>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Inteligência & Modelos" note="Orquestrador cognitivo e ferramentas de agentes">
          <SelectRow
            label="Modelo predefinido"
            hint="Utilizado por defeito nas conversas rápidas"
            value={modelName}
            options={modelLabels}
            onChange={(label) => {
              const found = availableModels.find((model) => model.label === label);
              if (!found) return;
              setDefaultModel(found.id);
              window.localStorage.setItem(MODEL_KEY, found.id);
            }}
          />
          <SelectRow
            label="Modo de resposta"
            hint="Equilíbrio entre velocidade e raciocínio dos agentes"
            value={text("qualityMode")}
            options={["Velocidade", "Equilíbrio", "Qualidade"]}
            onChange={(v) => set("qualityMode", v)}
          />
          <ToggleRow
            label="Guardar histórico de conversas"
            hint="Preserva as conversas e turnos de chat na base de dados"
            value={bool("saveHistory")}
            onChange={(v) => set("saveHistory", v)}
          />
          <ActionRow
            label="Plugins & Integrações"
            hint="GitHub, Supabase, Vercel, Stripe, Redis e mais"
            value={`${connectedPluginsCount} ligados`}
            onClick={() => setPluginsViewOpen(true)}
          />
        </SettingsGroup>

        <SettingsGroup title="Voz & Áudio" note="Síntese fonética, velocidade e sensibilidade vocal">
          <SelectRow
            label="Voz do GRIOT"
            hint={`Vozes nativas do idioma ativo (${langInfo.name})`}
            value={text("voice")}
            options={voiceOptions}
            onChange={(v) => set("voice", v)}
          />
          <SelectRow
            label="Velocidade da fala"
            value={text("voiceSpeed")}
            options={["0.8×", "1.0×", "1.2×", "1.5×"]}
            onChange={(v) => set("voiceSpeed", v)}
          />
          <ToggleRow
            label="Responder automaticamente em voz"
            hint="Lê a resposta do modelo em voz alta assim que o texto é gerado"
            value={bool("autoSpeak")}
            onChange={(v) => set("autoSpeak", v)}
          />
          <ToggleRow
            label="Interrupção por voz (Barge-in)"
            hint="Pausa a fala da IA suavemente assim que começas a falar"
            value={bool("allowInterrupt")}
            onChange={(v) => set("allowInterrupt", v)}
          />
          <ActionRow
            label="Testar Áudio e Microfone"
            hint="Verificar gravação, níveis de som e voz de teste"
            onClick={() => {
              setTestModalMode("voice");
              setTestModalOpen(true);
            }}
          />
          <ActionRow
            label="Testar Câmara e Resolução"
            hint="Verificar o feed de vídeo para multimodalidade"
            onClick={() => {
              setTestModalMode("camera");
              setTestModalOpen(true);
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="Permissões & Segurança" note="Acesso real a sensores de hardware e biometria">
          <ActionRow
            label="Exigir permissões nativas"
            hint="Pede autorização de câmara, microfone e notificações de uma vez"
            onClick={() => void requestAllNativePermissions()}
          />
          <ToggleRow
            label="Câmara"
            hint="Permite tirar fotos e enviar imagens para o modelo"
            value={bool("permCamera")}
            onChange={async (v) => {
              if (v) await requestRealCameraPermission();
              set("permCamera", v);
            }}
          />
          <ToggleRow
            label="Microfone"
            hint="Permite transcrição de voz e conversação contínua"
            value={bool("permMic")}
            onChange={async (v) => {
              if (v) await requestRealMicrophonePermission();
              set("permMic", v);
            }}
          />
          <ToggleRow
            label="Localização GPS"
            hint="Permite que o modelo responda com contexto da tua região"
            value={bool("permLocation")}
            onChange={async (v) => {
              if (v) await requestRealLocationPermission();
              set("permLocation", v);
            }}
          />
          <ActionRow
            label="Autenticação Biométrica"
            hint="Testar Face ID / Impressão Digital via WebAuthn nativo"
            value={bool("biometrics") ? "Ativa" : "Desativada"}
            onClick={async () => {
              const ok = await verifyRealBiometrics();
              if (ok) set("biometrics", true);
            }}
          />
          <ActionRow
            label="Limpar todos os dados locais (Wipe)"
            hint="Apaga o histórico local e caches do dispositivo"
            danger
            onClick={async () => {
              if (window.confirm(t("Tens a certeza absoluta? Esta ação limpa todos os dados locais do dispositivo."))) {
                await clearAllLocalData();
                setCacheStats(getLocalCacheStats());
                toast.success(t("Dados locais limpos com sucesso."));
              }
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="Notificações" note="Alertas em segundo plano no dispositivo">
          <ToggleRow
            label="Tarefas concluídas"
            hint="Notificar quando os agentes terminarem a execução"
            value={bool("notify:taskDone")}
            onChange={(v) => set("notify:taskDone", v)}
          />
          <ToggleRow
            label="Aprovações pendentes"
            hint="Avisar quando um agente precisar da tua autorização"
            value={bool("notify:approval")}
            onChange={(v) => set("notify:approval", v)}
          />
          <ToggleRow
            label="Falhas de compilação ou deploy"
            hint="Alertar imediatamente sobre erros críticos em projetos"
            value={bool("notify:buildFailed")}
            onChange={(v) => set("notify:buildFailed", v)}
          />
          <ActionRow
            label="Testar notificação nativa"
            hint="Dispara um alerta nativo de teste no dispositivo"
            onClick={async () => {
              await testSystemNotification();
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="Aparência & Idioma" note="Interface visual, escala tipográfica e idioma">
          <SelectRow
            label="Modo de tema"
            value={text("appearance")}
            options={["Sistema", "Claro", "Escuro"]}
            onChange={(v) => {
              set("appearance", v);
              if (v === "Claro" && theme !== "light") toggle();
              else if (v === "Escuro" && theme !== "dark") toggle();
              else if (v === "Sistema") {
                const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                if (dark && theme !== "dark") toggle();
                if (!dark && theme !== "light") toggle();
              }
            }}
          />
          <SelectRow
            label="Tamanho do texto"
            value={text("textSize")}
            options={["Compacto", "Padrão", "Grande"]}
            onChange={(v) => set("textSize", v)}
          />
          <ToggleRow
            label="Reduzir movimento"
            hint="Desativa animações e transições na interface"
            value={bool("reduceMotion")}
            onChange={(v) => set("reduceMotion", v)}
          />
          <ToggleRow
            label="Feedback tátil (Haptics)"
            hint="Vibração ao tocar em controlos e nos turnos de voz"
            value={bool("haptics")}
            onChange={(v) => set("haptics", v)}
          />
          <SelectRow
            label="Idioma da aplicação"
            hint="Muda a interface imediatamente"
            searchable
            value={currentAppLang}
            options={LANGUAGE_LABELS}
            onChange={(lang) => {
              const loc = localeFromLabel(lang);
              if (loc) {
                void setLocale(loc);
                set("appLanguage", lang);
              }
            }}
          />
          <SelectRow
            label="Idioma preferido de respostas"
            hint="Idioma em que a inteligência deve responder"
            searchable
            value={text("answerLanguage")}
            options={ANSWER_LANGUAGES}
            onChange={(v) => set("answerLanguage", v)}
          />
          <InfoRow
            label="Espaço em cache"
            value={`${cacheStats.formatted} (${cacheStats.count} itens)`}
            hint="Armazenamento local ocupado"
          />
          <ActionRow
            label="Limpar cache de dados"
            hint="Liberta memória mantendo a tua sessão e credenciais"
            onClick={() => {
              if (typeof window !== "undefined") {
                const toRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && (k.startsWith("griot_cache_") || k.startsWith("tanstack_"))) {
                    toRemove.push(k);
                  }
                }
                toRemove.forEach((k) => localStorage.removeItem(k));
                setCacheStats(getLocalCacheStats());
                toast.success(t("Cache limpa com sucesso."));
              }
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="Sobre & Sistema" note="Informação da versão e ferramentas de diagnóstico">
          <InfoRow label="Versão da app" value="1.0.25" />
          <InfoRow label="Compilação (Build)" value="2026.09.06 (v26)" />
          <InfoRow label="Região / Backend" value="eu-central-1 (Supabase)" />
          <ActionRow
            label="Termos e Condições"
            hint="Políticas de privacidade e termos do serviço"
            onClick={() => setShowTerms(true)}
          />
          <ActionRow
            label="Logs da consola"
            hint="Ver telemetria e registos de execução"
            onClick={() => void navigate({ to: "/control" })}
          />
          <ActionRow
            label="Exportar diagnóstico"
            hint="Copiar JSON com estado do sistema e preferências"
            onClick={() => {
              void navigator.clipboard.writeText(
                JSON.stringify({ prefs, cacheStats, user: activeUser?.id }, null, 2),
              );
              toast.success(t("Diagnóstico copiado para a área de transferência."));
            }}
          />
          <ToggleRow
            label="Modo programador"
            hint="Ativa logs detalhados e ferramentas de inspeção"
            value={bool("developerMode")}
            onChange={(v) => set("developerMode", v)}
          />
        </SettingsGroup>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center justify-between rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-destructive hover:bg-destructive/10 active:scale-[0.99] transition-all"
          >
            <span className="text-[15px] font-semibold">{t("Terminar sessão")}</span>
            <LogOut className="size-[18px] shrink-0" />
          </button>
        </div>

        <p className="flex items-center justify-center gap-1.5 pt-2 pb-4 text-[12px] text-muted-foreground/70">
          <Sparkle className="size-3 text-primary" /> GRIOT Mobile · {t("produção v1.0.25")}
        </p>
      </div>

      <VoiceTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        mode={testModalMode}
      />
      {showTerms && (
        <TermsDialog forceOpen onClose={() => setShowTerms(false)} />
      )}
    </Screen>
  );
}

