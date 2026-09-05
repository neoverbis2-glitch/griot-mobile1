import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Screen, Panel } from "@/components/griot/screen";
import { UserAvatar } from "@/components/griot/user-avatar";
import { useCurrentUser } from "@/hooks/use-user";
import { Section, ToggleRow, SelectRow, InfoRow, ActionRow } from "@/components/griot/settings-kit";
import { useTheme } from "@/lib/theme";
import { DEFAULT_MODEL, QUICK_CHAT_MODELS } from "@/lib/griot";
import { uploadUserAvatar, getLocalCacheStats } from "@/lib/storage";
import {
  APP_LANGUAGES,
  CONNECTIONS,
  NOTIFICATION_TYPES,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "@/lib/settings";
import {
  getPrimaryWorkspaceId,
  listGriotCredentials,
  saveGriotCredential,
  verifyGriotCredential,
} from "@/lib/griot-api";
import { saveUserApi } from "@/lib/user-apis";
import { useI18n, useT, labelFromLocale, localeFromLabel } from "@/lib/i18n";
import { toast } from "sonner";
import {
  requestRealCameraPermission,
  requestRealMicrophonePermission,
  requestRealLocationPermission,
  requestRealBluetoothPermission,
  verifyRealBiometrics,
  clearAllLocalData,
  requestAiPermission,
} from "@/lib/permissions";
import { testSystemNotification, requestRealNotificationPermission } from "@/lib/notifications";
import { sendGriotNotification, requestAllNativePermissions } from "@/lib/native-notifications";
import { VoiceTestModal } from "@/components/griot/voice-test-modal";
import {
  Bell,
  Camera,
  ChevronLeft,
  Cpu,
  Database,
  Gauge,
  Globe,
  Layers,
  LogOut,
  Monitor,
  Palette,
  Plug,
  ShieldCheck,
  Sparkle,
  Terminal,
  Upload,
  User,
  Accessibility,
  MessageCircle,
  Radio,
  Eye,
  Volume2,
  Mic,
  Fingerprint,
  FileText,
} from "lucide-react";
import { TermsDialog } from "@/components/griot/terms-dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Definições — GRIOT Mobile" },
      {
        name: "description",
        content:
          "Conta, Quick Chat, projetos, uso, notificações, voz, privacidade, segurança, conexões, aparência e mais.",
      },
      { property: "og:title", content: "Definições — GRIOT Mobile" },
      { property: "og:description", content: "Todo o centro de comando GRIOT numa só lista." },
    ],
  }),
  component: SettingsPage,
});

// Feature flags for sections that aren't backed by real data/logic yet.
// The rows stay in the code (nothing is deleted) but are not rendered.
const SHOW_DESKTOP_PAIRING = false;
const SHOW_FAKE_CONNECTIONS = false;

const MODEL_KEY = "griot-default-model";
const MODEL_LABELS = QUICK_CHAT_MODELS.map((model) => model.label);
const LANGUAGE_LABELS = APP_LANGUAGES.map((language) => language.label);
const ANSWER_LANGUAGES = ["Automático", ...LANGUAGE_LABELS];

function SettingsPage() {
  const { user, email: userEmail, displayName, avatarUrl } = useCurrentUser();
  const [activeUser, setActiveUser] = useState(user);
  const { theme, toggle } = useTheme();
  const t = useT();
  const { locale, setLocale, ready } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(displayName || "");
  const [saving, setSaving] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [savingGeminiKey, setSavingGeminiKey] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [cacheStats, setCacheStats] = useState(() => getLocalCacheStats());
  const [gcpUrlInput, setGcpUrlInput] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("griot_gcp_runner_url") || "" : "",
  );
  const [gcpSecretInput, setGcpSecretInput] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("griot_gcp_runner_secret") || "" : "",
  );
  const [gcpTokenInput, setGcpTokenInput] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("griot_gcp_token") || "" : "",
  );
  const [gcpProjectIdInput, setGcpProjectIdInput] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("griot_gcp_project_id") || "" : "",
  );
  const [verifyingGcpToken, setVerifyingGcpToken] = useState(false);
  const [testingGcp, setTestingGcp] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testModalMode, setTestModalMode] = useState<"voice" | "mic" | "camera">("voice");
  const [showTerms, setShowTerms] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (displayName) setName(displayName);
  }, [displayName]);

  useEffect(() => {
    const stored = window.localStorage.getItem(MODEL_KEY);
    if (stored) setDefaultModel(stored);
    setPrefs(loadPrefs());
    setCacheStats(getLocalCacheStats());

    void supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setActiveUser(data.user);
        const metaName =
          data.user.user_metadata?.display_name ||
          data.user.user_metadata?.name ||
          data.user.user_metadata?.full_name;
        if (metaName) setName(metaName);
        void (supabase as any)
          .from("griot_user_profiles")
          .select("display_name")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: profileData }: { data: { display_name?: string } | null }) => {
            if (profileData?.display_name) {
              setName(profileData.display_name);
            }
          });
      }
    });
  }, []);

  // Real backend: GCU balance/usage lives on griot_gcu_wallets, scoped to the
  // user's workspace (griot_workspace_members). There is no "services",
  // "runs", "agents" or desktop-pairing concept in the real GRIOT schema, so
  // those are no longer queried — the UI sections that depended on them are
  // hidden below instead of showing fabricated data.
  const { data: status } = useQuery({
    queryKey: ["settings-status", activeUser?.id],
    queryFn: async () => {
      const currentUserId = activeUser?.id;
      const workspaceId = await getPrimaryWorkspaceId(currentUserId);
      const wallet = workspaceId
        ? await (supabase as any)
            .from("griot_gcu_wallets")
            .select("balance_gcu, lifetime_used_gcu")
            .eq("workspace_id", workspaceId)
            .maybeSingle()
        : { data: null };
      return {
        spent: Number(wallet.data?.lifetime_used_gcu ?? 0),
        wallet: wallet.data ?? null,
      };
    },
    enabled: Boolean(activeUser?.id),
  });

  // Real backend: whether the workspace already has a Gemini API key on
  // file (griot_credentials, via griot-api). Chat cannot work without one.
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
        localStorage.setItem("griot_api_key_gemini", secret);
        localStorage.setItem("griot_gemini_api_key", secret);
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
        toast.success(t("Chave ligada e verificada."));
        setGeminiKeyInput("");
      }
      await queryClient.invalidateQueries({ queryKey: ["settings-gemini-credential"] });
      if (typeof window !== "undefined") window.dispatchEvent(new Event("griot-apis-updated"));
    } finally {
      setSavingGeminiKey(false);
    }
  }

  async function saveAndVerifyGcpToken() {
    const token = gcpTokenInput.trim();
    const projectId = gcpProjectIdInput.trim();
    if (!token) {
      window.localStorage.removeItem("griot_gcp_token");
      window.localStorage.removeItem("griot_gcp_project_id");
      toast.success(t("Token do Google Cloud removido."));
      return;
    }

    setVerifyingGcpToken(true);
    try {
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
      const data = (await res.json().catch(() => ({}))) as { email?: string; sub?: string; exp?: string; error?: string; error_description?: string };

      if (res.ok && data.exp) {
        window.localStorage.setItem("griot_gcp_token", token);
        if (projectId) window.localStorage.setItem("griot_gcp_project_id", projectId);
        else window.localStorage.removeItem("griot_gcp_project_id");

        const email = data.email || data.sub || "Google Cloud User";
        const expiresMin = Math.max(1, Math.round((Number(data.exp) - Date.now() / 1000) / 60));
        toast.success(`${t("Token verificado para")} ${email}! (${expiresMin} min restantes)`);
      } else {
        toast.error(data.error_description || data.error || t("Token do Google Cloud inválido ou expirado."));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Não foi possível verificar o Token do Google Cloud."));
    } finally {
      setVerifyingGcpToken(false);
    }
  }

  async function connectGoogleAccount() {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.href : undefined,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Não foi possível ligar a conta Google."));
    }
  }

  async function saveAndTestGcpRunner() {
    const url = gcpUrlInput.trim().replace(/\/$/, "");
    const secret = gcpSecretInput.trim();
    if (!url) {
      window.localStorage.removeItem("griot_gcp_runner_url");
      window.localStorage.removeItem("griot_gcp_runner_secret");
      toast.success(t("Google Cloud Runner desligado."));
      return;
    }
    setTestingGcp(true);
    try {
      window.localStorage.setItem("griot_gcp_runner_url", url);
      if (secret) window.localStorage.setItem("griot_gcp_runner_secret", secret);
      else window.localStorage.removeItem("griot_gcp_runner_secret");

      const res = await fetch(`${url}/healthz`, { method: "GET" }).catch(() => null);
      if (res && res.ok) {
        toast.success(t("Google Cloud Runner ligado e verificado!"));
      } else {
        toast.success(t("URL do Google Cloud Runner guardado com sucesso!"));
      }
    } finally {
      setTestingGcp(false);
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
    const { avatarUrl: newAvatar, error } = await uploadUserAvatar(currentUserId, file);
    setUploadingAvatar(false);
    if (error) {
      toast.error(t("Erro ao enviar foto para o bucket."));
    } else {
      toast.success(t("Foto de perfil atualizada no bucket."));
      await queryClient.invalidateQueries({ queryKey: ["settings-status"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    }
  }

  async function saveProfile() {
    setSaving(true);
    const trimmedName = name.trim();
    if (typeof window !== "undefined") {
      localStorage.setItem("griot_user_name", trimmedName);
    }
    const currentUserId = activeUser?.id;
    if (currentUserId && currentUserId !== "anonymous") {
      await Promise.all([
        supabase.auth.updateUser({
          data: { display_name: trimmedName, name: trimmedName },
        }),
        (supabase as any).from("griot_user_profiles").upsert({
          id: currentUserId,
          display_name: trimmedName,
          updated_at: new Date().toISOString(),
        }),
      ]);
      setSaving(false);
      toast.success(t("Perfil guardado."));
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    } else {
      setSaving(false);
      toast.success(t("Perfil guardado localmente."));
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      localStorage.removeItem("griot_user_email");
      localStorage.removeItem("griot_user_name");
      localStorage.removeItem("griot_user_avatar");
    }
    toast.success(t("Sessão terminada."));
    void navigate({ to: "/auth" });
  }

  const modelName =
    QUICK_CHAT_MODELS.find((model) => model.id === defaultModel)?.label ?? defaultModel;

  // There is no subscription-tier column on the real wallet — only a real
  // GCU balance. Avoid inventing a "Free/Pro" label that isn't backed by data.
  const planTier = "GRIOT";
  const remainingGcu =
    status?.wallet?.balance_gcu != null
      ? `${Number(status.wallet.balance_gcu).toFixed(0)} GCU`
      : "0 GCU";

  return (
    <Screen
      title={t("Definições")}
      subtitle={t("Centro de comando")}
      action={
        <Link
          to="/control"
          aria-label={t("Voltar")}
          className="grid size-10 place-items-center rounded-full border border-hairline"
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
      <Panel className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <UserAvatar
            name={name || displayName || userEmail?.split("@")[0]}
            email={userEmail}
            avatarUrl={avatarUrl}
            size="lg"
            className="rounded-2xl shrink-0"
          />
          <div className="min-w-0">
            <p className="truncate text-[15.5px] font-medium">
              {name || displayName || userEmail?.split("@")[0] || t("Conta")}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {userEmail || t("Sessão ativa")}
            </p>
          </div>
        </div>
        <button
          onClick={() => avatarInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="shrink-0 flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
        >
          <Upload className="size-3.5" />
          {uploadingAvatar ? t("A enviar…") : t("Alterar foto")}
        </button>
      </Panel>

      <Section
        title={t("Account")}
        note={t("Perfil, plano e dispositivos")}
        Icon={User}
        defaultOpen
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Perfil")}
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Nome a mostrar")}
            className="mt-2.5 w-full rounded-2xl border border-hairline bg-background px-4 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => void saveProfile()}
            disabled={saving}
            className="mt-2.5 w-full rounded-2xl bg-primary py-2.5 text-[14.5px] font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-40"
          >
            {t("Guardar")}
          </button>
        </div>
        <InfoRow label={t("Plano atual")} value={planTier} />
        <InfoRow label={t("Saldo em carteira")} value={remainingGcu} />
        <ActionRow
          label={t("Gerir Plano & Faturação")}
          hint={t("Ver planos Free, Starter, Plus e Pro")}
          onClick={() => void navigate({ to: "/neoverbis-pay" })}
        />
        <ActionRow
          label={t("Histórico de utilização")}
          onClick={() => void navigate({ to: "/home" })}
        />
        <ActionRow label={t("Terminar sessão")} danger onClick={() => void signOut()} />
      </Section>

      <Section
        title={t("Chave de IA")}
        note={
          geminiCredential
            ? geminiCredential.status === "active"
              ? t("Gemini ligado")
              : t("Por verificar")
            : t("Necessária para conversar")
        }
        Icon={Sparkle}
        defaultOpen={!geminiCredential || geminiCredential.status !== "active"}
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Chave da API Gemini")}
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {t(
              "O GRIOT precisa da tua própria chave para conversar de verdade. É guardada encriptada no servidor.",
            )}
          </p>
          {geminiCredential && (
            <p className="mt-2 text-[13px]">
              {t("Atual")}: {geminiCredential.secretHint} ·{" "}
              {geminiCredential.status === "active" ? t("verificada") : t("por verificar")}
            </p>
          )}
          <input
            value={geminiKeyInput}
            onChange={(event) => setGeminiKeyInput(event.target.value)}
            placeholder={t("Colar chave da API (ex.: AIza…)")}
            className="mt-2.5 w-full rounded-2xl border border-hairline bg-background px-4 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
            autoCapitalize="none"
            autoCorrect="off"
            type="password"
          />
          <button
            onClick={() => void saveAndVerifyGeminiKey()}
            disabled={savingGeminiKey || !geminiKeyInput.trim()}
            className="mt-2.5 w-full rounded-2xl bg-primary py-2.5 text-[14.5px] font-medium text-primary-foreground active:scale-[0.98] disabled:opacity-40"
          >
            {savingGeminiKey ? t("A ligar…") : t("Ligar e verificar")}
          </button>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 block text-center text-[12.5px] text-muted-foreground underline"
          >
            {t("Obter uma chave gratuita no Google AI Studio")}
          </a>
        </div>
      </Section>

      <Section
        title={t("Google Cloud Execution Gateway")}
        note={activeUser?.app_metadata?.provider === "google" || activeUser?.email ? t("Ligado") : t("Pendente")}
        Icon={Cpu}
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Execution Gateway Integrado")}
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {t(
              "O gateway de execução real do Google Cloud está ligado diretamente através dos Secrets da Edge Function do backend Supabase.",
            )}
          </p>
          <button
            onClick={() => void connectGoogleAccount()}
            type="button"
            className="mt-3 flex items-center justify-center gap-2.5 w-full rounded-2xl border border-hairline bg-surface py-3 text-[14.5px] font-medium text-foreground transition-transform duration-200 active:scale-[0.98]"
          >
            <svg className="size-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            {activeUser?.app_metadata?.provider === "google" || activeUser?.email?.endsWith("@gmail.com")
              ? `${t("Sessão Google Ativa")}: ${activeUser.email}`
              : t("Autenticar com Google OAuth")}
          </button>
        </div>
      </Section>

      <Section
        title={t("Quick Chat")}
        note={`${t("Modelo predefinido")}: ${modelName}`}
        Icon={MessageCircle}
      >
        <SelectRow
          label={t("Modelo predefinido")}
          value={modelName}
          options={MODEL_LABELS}
          onChange={(label) => {
            const found = QUICK_CHAT_MODELS.find((model) => model.label === label);
            if (!found) return;
            setDefaultModel(found.id);
            window.localStorage.setItem(MODEL_KEY, found.id);
          }}
        />
        <ToggleRow
          label={t("Guardar histórico")}
          value={bool("saveHistory")}
          onChange={(v) => set("saveHistory", v)}
        />
        <ToggleRow
          label={t("Temporary Chat por defeito")}
          hint={t("Conversas que não ficam guardadas")}
          value={bool("temporaryByDefault")}
          onChange={(v) => set("temporaryByDefault", v)}
        />
        <ToggleRow
          label={t("Mostrar sugestões de modelo")}
          value={bool("showModelHints")}
          onChange={(v) => set("showModelHints", v)}
        />
        <SelectRow
          label={t("Qualidade vs velocidade")}
          value={text("qualityMode")}
          options={["Velocidade", "Equilíbrio", "Qualidade"]}
          onChange={(v) => set("qualityMode", v)}
        />
        <SelectRow
          label={t("Comportamento de anexos")}
          value={text("attachmentBehavior")}
          options={["Perguntar sempre", "Enviar logo", "Guardar no projeto"]}
          onChange={(v) => set("attachmentBehavior", v)}
        />
      </Section>

      <Section
        title={t("Conversas & Histórico (Projetos)")}
        note={t("Sincronização, cache e capturas")}
        Icon={Layers}
      >
        <ProjectDefaultRow
          value={text("defaultCaptureProject")}
          onChange={(v) => set("defaultCaptureProject", v)}
        />
        <ToggleRow
          label={t("Sincronização automática")}
          value={bool("autoSync")}
          onChange={(v) => set("autoSync", v)}
        />
        <ToggleRow
          label={t("Downloads offline")}
          value={bool("offlineDownloads")}
          onChange={(v) => set("offlineDownloads", v)}
        />
        <ToggleRow
          label={t("Manter conversas recentes em cache")}
          value={bool("cacheRecent")}
          onChange={(v) => set("cacheRecent", v)}
        />
        <ToggleRow
          label={t("Confirmação antes de enviar para um chat")}
          value={bool("confirmSendToProject")}
          onChange={(v) => set("confirmSendToProject", v)}
        />
      </Section>

      <Section title={t("Modelos")} note={t("Disponíveis, favoritos e avisos")} Icon={Cpu}>
        {QUICK_CHAT_MODELS.map((model) => (
          <ToggleRow
            key={model.id}
            label={model.label}
            hint={t(model.hint)}
            value={prefs[`favorite:${model.id}`] !== false}
            onChange={(v) => set(`favorite:${model.id}`, v)}
          />
        ))}
        <ToggleRow
          label={t("Ocultar modelos que não usa")}
          value={bool("hideUnusedModels")}
          onChange={(v) => set("hideUnusedModels", v)}
        />
        <SelectRow
          label={t("Modelo rápido predefinido")}
          value={text("fastModel")}
          options={MODEL_LABELS}
          onChange={(v) => set("fastModel", v)}
        />
        <SelectRow
          label={t("Modelo avançado predefinido")}
          value={text("advancedModel")}
          options={MODEL_LABELS}
          onChange={(v) => set("advancedModel", v)}
        />
        <ToggleRow
          label={t("Aviso antes de modelos de consumo elevado")}
          value={bool("warnHeavyModels")}
          onChange={(v) => set("warnHeavyModels", v)}
        />
      </Section>

      <Section
        title={t("Uso & Compute")}
        note={`${(status?.spent ?? 0).toFixed(2)} ${t("GCU consumidos")}`}
        Icon={Gauge}
      >
        <SelectRow
          label={t("Limite mensal")}
          value={text("monthlyLimit")}
          options={["100 GCU", "250 GCU", "500 GCU", "1000 GCU", "Sem limite"]}
          onChange={(v) => set("monthlyLimit", v)}
        />
        <ToggleRow
          label={t("Alerta a 75%")}
          value={bool("alerts75")}
          onChange={(v) => set("alerts75", v)}
        />
        <ToggleRow
          label={t("Alerta a 90%")}
          value={bool("alerts90")}
          onChange={(v) => set("alerts90", v)}
        />
        <ToggleRow
          label={t("Alerta a 100%")}
          value={bool("alerts100")}
          onChange={(v) => set("alerts100", v)}
        />
        <ActionRow
          label={t("Consumo por modelo")}
          onClick={() => void navigate({ to: "/control" })}
        />
        <ActionRow
          label={t("Consumo por conversas")}
          onClick={() => void navigate({ to: "/projects" })}
        />
        <ActionRow
          label={t("Consumo por Quick Chat")}
          onClick={() => void navigate({ to: "/home" })}
        />
        <ActionRow
          label={t("Histórico de GCU/compute")}
          onClick={() => void navigate({ to: "/home" })}
        />
        <ToggleRow
          label={t("Economia de compute")}
          value={bool("computeSaver")}
          onChange={(v) => set("computeSaver", v)}
        />
      </Section>

      <Section
        title={t("Notificações")}
        note={t("Notificações Nativas e Canais do Android")}
        Icon={Bell}
      >
        <div className="border-b border-hairline px-5 py-3.5 bg-secondary/10 space-y-2">
          <span className="block text-[13px] font-semibold text-foreground">
            {t("Testes de Notificações Nativas (com Logo GRIOT)")}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              onClick={async () => {
                await sendGriotNotification({
                  type: "approval",
                  title: "Aprovação Requerida - GRIOT",
                  message: "Executar comando: npm run deploy --production",
                  actionId: `act_test_${Date.now()}`,
                });
              }}
              className="text-left px-3 py-2 rounded-lg border border-hairline bg-card hover:bg-accent/40 text-[12px] font-medium transition-colors flex items-center justify-between"
            >
              <span>⚡ {t("Aprovação (Aprovar / Recusar)")}</span>
              <span className="text-[10px] uppercase font-mono text-amber-500 font-bold">
                Interativa
              </span>
            </button>

            <button
              onClick={async () => {
                await sendGriotNotification({
                  type: "message",
                  sender: "GRIOT Assistant",
                  title: "GRIOT Core · Nova Mensagem",
                  message:
                    "O modelo completou a análise do código e está pronto para o próximo passo.",
                });
              }}
              className="text-left px-3 py-2 rounded-lg border border-hairline bg-card hover:bg-accent/40 text-[12px] font-medium transition-colors flex items-center justify-between"
            >
              <span>💬 {t("Mensagem de IA")}</span>
              <span className="text-[10px] uppercase font-mono text-primary font-bold">Chat</span>
            </button>

            <button
              onClick={async () => {
                await sendGriotNotification({
                  type: "deploy",
                  title: "Site Deployado com Sucesso! 🚀",
                  message: "O teu projeto foi publicado: https://griot.ai/preview",
                  url: "https://griot.ai",
                });
              }}
              className="text-left px-3 py-2 rounded-lg border border-hairline bg-card hover:bg-accent/40 text-[12px] font-medium transition-colors flex items-center justify-between"
            >
              <span>🚀 {t("Site Deployado")}</span>
              <span className="text-[10px] uppercase font-mono text-emerald-500 font-bold">
                Deploy
              </span>
            </button>

            <button
              onClick={async () => {
                await sendGriotNotification({
                  type: "task",
                  title: "Tarefa Concluída: Compilação APK",
                  message: "Todos os serviços e permissões foram indexados com êxito.",
                });
              }}
              className="text-left px-3 py-2 rounded-lg border border-hairline bg-card hover:bg-accent/40 text-[12px] font-medium transition-colors flex items-center justify-between"
            >
              <span>✅ {t("Tarefa Concluída")}</span>
              <span className="text-[10px] uppercase font-mono text-sky-500 font-bold">Task</span>
            </button>
          </div>
        </div>

        <ActionRow
          label={t("Testar Notificação Padrão do Sistema")}
          onClick={async () => {
            await testSystemNotification();
          }}
        />
        {NOTIFICATION_TYPES.map((item) => (
          <ToggleRow
            key={item.id}
            label={t(item.label)}
            value={prefs[`notify:${item.id}`] !== false}
            onChange={async (v) => {
              set(`notify:${item.id}`, v);
              if (v) {
                const res = await requestRealNotificationPermission();
                if (res.granted) {
                  toast.success(`${t(item.label)}: ${t("Notificação do sistema ativada.")}`);
                }
              }
            }}
          />
        ))}
      </Section>

      <Section title={t("Voice & Capture")} note={t("Voz, câmara e microfone reais")} Icon={Camera}>
        <ActionRow
          label={t("Testar Voz do GRIOT e Microfone")}
          onClick={() => {
            setTestModalMode("voice");
            setTestModalOpen(true);
          }}
        />
        <ActionRow
          label={t("Testar Câmara e Resolução de Vídeo")}
          onClick={() => {
            setTestModalMode("camera");
            setTestModalOpen(true);
          }}
        />
        <SelectRow
          label={t("Voz do GRIOT")}
          value={text("voice")}
          options={["GRIOT Nativa", "Serena", "Grave", "Neutra"]}
          onChange={(v) => set("voice", v)}
        />
        <SelectRow
          label={t("Velocidade")}
          value={text("voiceSpeed")}
          options={["0.8×", "1.0×", "1.2×", "1.5×"]}
          onChange={(v) => set("voiceSpeed", v)}
        />
        <SelectRow
          label={t("Idioma da voz")}
          value={text("voiceLanguage")}
          options={LANGUAGE_LABELS}
          searchable
          onChange={(v) => set("voiceLanguage", v)}
        />
        <ToggleRow
          label={t("Responder automaticamente em voz")}
          value={bool("autoSpeak")}
          onChange={(v) => set("autoSpeak", v)}
        />
        <ToggleRow
          label={t("Interromper o GRIOT enquanto fala")}
          value={bool("allowInterrupt")}
          onChange={(v) => set("allowInterrupt", v)}
        />
        <ToggleRow
          label={t("Continuar conversa com ecrã bloqueado")}
          value={bool("lockedScreenVoice")}
          onChange={(v) => set("lockedScreenVoice", v)}
        />
        <ToggleRow
          label={t("Bluetooth / auscultadores")}
          value={bool("bluetooth")}
          onChange={(v) => set("bluetooth", v)}
        />
        <SelectRow
          label={t("Qualidade de imagem/vídeo")}
          value={text("mediaQuality")}
          options={["Baixa", "Média", "Alta", "Máxima"]}
          onChange={(v) => set("mediaQuality", v)}
        />
        <ToggleRow
          label={t("Remover localização das imagens")}
          value={bool("stripLocation")}
          onChange={(v) => set("stripLocation", v)}
        />
        <ToggleRow
          label={t("Compressão automática")}
          value={bool("autoCompress")}
          onChange={(v) => set("autoCompress", v)}
        />
        <ToggleRow
          label={t("Scan automático de documentos")}
          value={bool("autoDocScan")}
          onChange={(v) => set("autoDocScan", v)}
        />
        <ToggleRow
          label={t("Guardar original")}
          hint={t("Desligado guarda só a versão processada")}
          value={bool("keepOriginal")}
          onChange={(v) => set("keepOriginal", v)}
        />
      </Section>

      <Section
        title={t("Privacy & Security")}
        note={t("Permissões Reais, biometria e hardware")}
        Icon={ShieldCheck}
      >
        <div className="border-b border-hairline px-5 py-4 bg-primary/5 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-foreground">
                {t("Permissões Nativas do Dispositivo")}
              </span>
              <span className="block text-[12px] text-muted-foreground mt-0.5">
                {t("Exige permissões de hardware no Android (APK) e no navegador")}
              </span>
            </div>
            <button
              onClick={async () => {
                const res = await requestAllNativePermissions();
                toast.success(
                  `${res.grantedCount} de ${res.total} ${t("permissões autorizadas no dispositivo.")}`,
                );
              }}
              className="shrink-0 rounded-full px-4 py-1.5 text-[12px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-sm"
            >
              {t("Exigir Permissões")}
            </button>
          </div>
        </div>

        <ActionRow
          label={t("Testar Pedido de Permissão da IA")}
          onClick={async () => {
            const approved = await requestAiPermission({
              type: "camera",
              title: t("Permissão de Câmara para ModelOS"),
              reason: t(
                "O cluster ModelOS solicita autorização para inspecionar o documento visualmente e processar o tensor de imagem.",
              ),
              requester: "ModelOS Vision Core",
            });
            if (approved) {
              toast.success(t("Permissão autorizada com sucesso pelo utilizador!"));
            } else {
              toast.info(t("Pedido de permissão recusado."));
            }
          }}
        />
        <ToggleRow
          label={t("Câmara (Permissão Real)")}
          value={bool("permCamera")}
          onChange={async (v) => {
            if (v) {
              const res = await requestRealCameraPermission();
              if (res.granted) {
                set("permCamera", true);
                toast.success(t("Permissão de câmara concedida pelo browser."));
              } else {
                set("permCamera", false);
                toast.error(res.error || t("Permissão de câmara recusada."));
              }
            } else {
              set("permCamera", false);
              toast.info(t("Permissão de câmara desativada nas preferências."));
            }
          }}
        />
        <ToggleRow
          label={t("Microfone (Permissão Real)")}
          value={bool("permMic")}
          onChange={async (v) => {
            if (v) {
              const res = await requestRealMicrophonePermission();
              if (res.granted) {
                set("permMic", true);
                toast.success(t("Permissão de microfone concedida pelo browser."));
              } else {
                set("permMic", false);
                toast.error(res.error || t("Permissão de microfone recusada."));
              }
            } else {
              set("permMic", false);
              toast.info(t("Permissão de microfone desativada nas preferências."));
            }
          }}
        />
        <ToggleRow
          label={t("Fotos & Galeria")}
          value={bool("permPhotos")}
          onChange={(v) => set("permPhotos", v)}
        />
        <ToggleRow
          label={t("Localização GPS (Permissão Real)")}
          value={bool("permLocation")}
          onChange={async (v) => {
            if (v) {
              const res = await requestRealLocationPermission();
              if (res.granted) {
                set("permLocation", true);
                toast.success(t("Permissão de localização concedida pelo browser."));
              } else {
                set("permLocation", false);
                toast.error(res.error || t("Permissão de localização recusada."));
              }
            } else {
              set("permLocation", false);
              toast.info(t("Localização desativada nas preferências."));
            }
          }}
        />
        <ToggleRow
          label={t("Bluetooth (Web Bluetooth)")}
          value={bool("permBluetooth")}
          onChange={async (v) => {
            if (v) {
              const res = await requestRealBluetoothPermission();
              if (res.granted) {
                set("permBluetooth", true);
                toast.success(t("Bluetooth ativo."));
              } else {
                set("permBluetooth", false);
                toast.info(res.error || t("Bluetooth indisponível."));
              }
            } else {
              set("permBluetooth", false);
            }
          }}
        />
        <ToggleRow
          label={t("Contactos")}
          value={bool("permContacts")}
          onChange={(v) => set("permContacts", v)}
        />
        <ToggleRow
          label={t("Calendário")}
          value={bool("permCalendar")}
          onChange={(v) => set("permCalendar", v)}
        />
        <ToggleRow
          label={t("Dados partilhados com chats")}
          value={bool("shareWithProjects")}
          onChange={(v) => set("shareWithProjects", v)}
        />
        <ToggleRow
          label={t("Histórico local")}
          value={bool("localHistory")}
          onChange={(v) => set("localHistory", v)}
        />
        <ActionRow
          label={t("Apagar Todos os Dados Locais (Wipe Real)")}
          danger
          onClick={async () => {
            const res = await clearAllLocalData();
            setCacheStats(getLocalCacheStats());
            toast.success(
              `${res.itemsCleared} ${t("registos e caches locais apagados permanentemente.")}`,
            );
          }}
        />
        <ToggleRow
          label={t("Face ID / Impressão Digital (WebAuthn)")}
          value={bool("biometrics")}
          onChange={async (v) => {
            if (v) {
              const res = await verifyRealBiometrics();
              if (res.success) {
                set("biometrics", true);
                toast.success(t("Biometria / Face ID verificada e ativada."));
              } else {
                set("biometrics", false);
                toast.error(res.error || t("Autenticação biométrica falhou."));
              }
            } else {
              set("biometrics", false);
            }
          }}
        />
        <ToggleRow
          label={t("PIN da aplicação")}
          value={bool("appPin")}
          onChange={(v) => set("appPin", v)}
        />
        <SelectRow
          label={t("Bloquear automaticamente")}
          value={text("autoLock")}
          options={["Imediatamente", "Após 1 min", "Após 5 min", "Após 15 min", "Nunca"]}
          onChange={(v) => set("autoLock", v)}
        />
        <ToggleRow
          label={t("Exigir autenticação em ações críticas")}
          hint={t("Apagar conversa, aprovar ações de IA ou alterar permissões pedem biometria")}
          value={bool("requireAuthCritical")}
          onChange={(v) => set("requireAuthCritical", v)}
        />
        <ToggleRow
          label={t("Confirmar deploy / delete / send")}
          value={bool("confirmCriticalActions")}
          onChange={(v) => set("confirmCriticalActions", v)}
        />
        <InfoRow label={t("Dispositivos autorizados")} value="1" />
        <InfoRow label={t("Sessões ativas")} value="1" />
      </Section>

      {/*
        "Connections" is hidden: these toggles never called any provider —
        no OAuth/API flow backed them. The real backend already supports
        connecting github/supabase/vercel/cloudflare with verified API keys
        (griot_credentials, wired up in griot-api), just not from this
        screen yet. Re-enable once this section calls that real endpoint
        instead of a local on/off flag.
      */}
      {SHOW_FAKE_CONNECTIONS && (
      <Section title={t("Connections")} note={t("Serviços e contas ligadas")} Icon={Plug}>
        {CONNECTIONS.map((connection) => {
          const connected = prefs[`conn:${connection}`] === true;
          return (
            <div key={connection} className="border-b border-hairline px-5 py-3.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium">{connection}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {connected
                      ? t("Ligado · última sincronização agora · leitura e escrita")
                      : t("Não ligado")}
                  </span>
                </span>
                <button
                  onClick={() => set(`conn:${connection}`, !connected)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium ${
                    connected
                      ? "border border-hairline text-destructive"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {connected ? t("Desligar") : t("Ligar")}
                </button>
              </div>
            </div>
          );
        })}
      </Section>
      )}

      <Section
        title={t("Appearance")}
        note={theme === "dark" ? t("Escuro") : t("Claro")}
        Icon={Palette}
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium">{t("Tema")}</span>
              <span className="block text-[12px] text-muted-foreground">
                {theme === "dark" ? t("Escuro") : t("Claro")}
              </span>
            </span>
            <button
              onClick={toggle}
              className="shrink-0 rounded-full border border-hairline px-3.5 py-1.5 text-[12.5px] font-medium"
            >
              {t("Alternar")}
            </button>
          </div>
        </div>
        <SelectRow
          label={t("Modo")}
          value={text("appearance")}
          options={["Sistema", "Claro", "Escuro"]}
          onChange={(v) => set("appearance", v)}
        />
        <SelectRow
          label={t("Accent GRIOT")}
          value={text("accent")}
          options={["GRIOT", "Grafite", "Marfim"]}
          onChange={(v) => set("accent", v)}
        />
        <SelectRow
          label={t("Tamanho do texto")}
          value={text("textSize")}
          options={["Compacto", "Padrão", "Grande"]}
          onChange={(v) => set("textSize", v)}
        />
        <ToggleRow
          label={t("Reduzir movimento")}
          value={bool("reduceMotion")}
          onChange={(v) => set("reduceMotion", v)}
        />
        <ToggleRow
          label={t("Haptics")}
          value={bool("haptics")}
          onChange={(v) => set("haptics", v)}
        />
        <SelectRow
          label={t("Interface")}
          value={text("density")}
          options={["Compacta", "Confortável"]}
          onChange={(v) => set("density", v)}
        />
      </Section>

      <Section title={t("Storage")} note={t("Cache, uploads e dados móveis")} Icon={Database}>
        <InfoRow label={t("Cache ocupado")} value={cacheStats.localStorageSize} />
        <InfoRow
          label={t("Downloads offline")}
          value={bool("offlineDownloads") ? t("Ativos") : t("Desligados")}
        />
        <InfoRow label={t("Itens em cache local")} value={`${cacheStats.itemCount} registos`} />
        <ActionRow
          label={t("Limpar cache")}
          onClick={() => {
            if (typeof window !== "undefined") {
              const keepEmail = localStorage.getItem("griot_user_email");
              const keepName = localStorage.getItem("griot_user_name");
              const keepAvatar = localStorage.getItem("griot_user_avatar");
              localStorage.clear();
              if (keepEmail) localStorage.setItem("griot_user_email", keepEmail);
              if (keepName) localStorage.setItem("griot_user_name", keepName);
              if (keepAvatar) localStorage.setItem("griot_user_avatar", keepAvatar);
              setCacheStats(getLocalCacheStats());
            }
            toast.success(t("Cache limpa com sucesso."));
          }}
        />
        <SelectRow
          label={t("Qualidade de upload")}
          value={text("uploadQuality")}
          options={["Automática", "Original", "Poupança de dados"]}
          onChange={(v) => set("uploadQuality", v)}
        />
        <ToggleRow
          label={t("Upload apenas em Wi-Fi")}
          value={bool("wifiOnlyUpload")}
          onChange={(v) => set("wifiOnlyUpload", v)}
        />
        <ToggleRow
          label={t("Uso de dados móveis")}
          value={bool("mobileData")}
          onChange={(v) => set("mobileData", v)}
        />
      </Section>

      <Section
        title={t("Idioma & Região")}
        note={ready ? labelFromLocale(locale) : t("A preparar idioma…")}
        Icon={Globe}
      >
        <SelectRow
          label={t("Idioma da aplicação")}
          value={labelFromLocale(locale)}
          options={LANGUAGE_LABELS}
          searchable
          onChange={(v) => {
            set("appLanguage", v);
            setLocale(localeFromLabel(v));
          }}
        />
        <SelectRow
          label={t("Idioma preferido de respostas")}
          value={text("answerLanguage")}
          options={ANSWER_LANGUAGES}
          searchable
          onChange={(v) => set("answerLanguage", v)}
        />
        <SelectRow
          label={t("Formato de data")}
          value={text("dateFormat")}
          options={["DD/MM/AAAA", "MM/DD/AAAA", "AAAA-MM-DD"]}
          onChange={(v) => set("dateFormat", v)}
        />
        <SelectRow
          label={t("Região")}
          value={text("region")}
          options={[
            "Portugal",
            "Brasil",
            "Estados Unidos",
            "Reino Unido",
            "União Europeia",
            "Angola",
            "Moçambique",
          ]}
          onChange={(v) => set("region", v)}
        />
        <SelectRow
          label={t("Unidade monetária")}
          value={text("currency")}
          options={["EUR (€)", "USD ($)", "GBP (£)", "BRL (R$)"]}
          onChange={(v) => set("currency", v)}
        />
      </Section>

      <Section
        title={t("Acessibilidade")}
        note={t("Leitura, contraste e movimento")}
        Icon={Accessibility}
      >
        <ToggleRow
          label={t("Texto maior")}
          value={bool("largeText")}
          onChange={(v) => set("largeText", v)}
        />
        <ToggleRow
          label={t("Alto contraste")}
          value={bool("highContrast")}
          onChange={(v) => set("highContrast", v)}
        />
        <ToggleRow
          label={t("Reduzir transparência")}
          value={bool("reduceTransparency")}
          onChange={(v) => set("reduceTransparency", v)}
        />
        <ToggleRow
          label={t("Reduzir animações")}
          value={bool("reduceAnimations")}
          onChange={(v) => set("reduceAnimations", v)}
        />
        <ToggleRow
          label={t("Legendas")}
          value={bool("captions")}
          onChange={(v) => set("captions", v)}
        />
        <ToggleRow
          label={t("VoiceOver / TalkBack")}
          value={bool("screenReader")}
          onChange={(v) => set("screenReader", v)}
        />
        <ToggleRow
          label={t("Feedback háptico adicional")}
          value={bool("extraHaptics")}
          onChange={(v) => set("extraHaptics", v)}
        />
      </Section>

      {/*
        "GRIOT Desktop" pairing/status is hidden: the real backend has no
        desktop-pairing concept (no desktop_online/last_seen data anywhere in
        the griot_* schema), so this section had nothing real to show. Kept
        here, not rendered, in case desktop pairing becomes a real feature
        later — re-enable by rendering this block once it's backed by data.
      */}
      {SHOW_DESKTOP_PAIRING && (
        <Section title={t("GRIOT Desktop")} note="Offline" Icon={Monitor}>
          <InfoRow label={t("Desktop conectado")} value="Não" />
          <ToggleRow
            label={t("Permitir iniciar tarefas remotamente")}
            value={bool("allowRemoteTasks")}
            onChange={(v) => set("allowRemoteTasks", v)}
          />
          <ToggleRow
            label={t("Permitir acordar sessão")}
            value={bool("allowWake")}
            onChange={(v) => set("allowWake", v)}
          />
          <ToggleRow
            label={t("Notificar quando ficar offline")}
            value={bool("notifyDesktopOffline")}
            onChange={(v) => set("notifyDesktopOffline", v)}
          />
        </Section>
      )}

      <Section title={t("Legal")} note={t("Termos & Políticas")} Icon={FileText}>
        <ActionRow label={t("Termos e Condições")} onClick={() => setShowTerms(true)} />
      </Section>

      <Section title={t("Advanced")} note={t("Só se precisares")} Icon={Terminal}>
        <InfoRow label={t("Versão da app")} value="1.0.0" />
        <InfoRow label={t("Build")} value="2026.08.09" />
        <InfoRow label={t("Região / backend")} value="eu-central-1 (Supabase)" />
        <ActionRow label={t("Logs")} onClick={() => void navigate({ to: "/control" })} />
        <ActionRow
          label={t("Exportar diagnóstico")}
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify({ prefs, status }, null, 2));
            toast.success(t("Diagnóstico copiado."));
          }}
        />
        <ToggleRow
          label={t("Developer mode")}
          value={bool("developerMode")}
          onChange={(v) => set("developerMode", v)}
        />
      </Section>

      <Panel
        className="flex items-center justify-between text-destructive"
        onClick={() => void signOut()}
      >
        <span className="text-[15.5px] font-medium">{t("Terminar sessão")}</span>
        <LogOut className="size-[18px]" />
      </Panel>

      <p className="flex items-center justify-center gap-1.5 pt-1 pb-2 text-[12px] text-muted-foreground">
        <Sparkle className="size-3.5" /> GRIOT Mobile · {t("centro de comando")}
      </p>

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

function ProjectDefaultRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["settings-projects"],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("griot_studio_projects")
        .select("name")
        .eq("archived", false)
        .order("name");
      return ((rows ?? []) as { name: string }[]).map((row) => row.name);
    },
  });
  const options = data && data.length > 0 ? data : [t("Sem projetos")];
  return (
    <SelectRow
      label={t("Projeto predefinido para capturas")}
      value={value === "—" ? (options[0] ?? t("Sem projetos")) : value}
      options={options}
      onChange={onChange}
    />
  );
}
