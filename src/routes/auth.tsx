import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { GriotMark } from "@/components/griot/logo";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Lock,
  User as UserIcon,
  Sparkles,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { TermsDialog, checkTermsAccepted } from "@/components/griot/terms-dialog";
import { initNativeAuthDeepLink, startOAuthFlow } from "@/lib/native-auth-deeplink";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — GRIOT Mobile" },
      {
        name: "description",
        content: "Entra no GRIOT e liga-te ao teu ecossistema a partir do bolso.",
      },
      { property: "og:title", content: "Entrar — GRIOT Mobile" },
      { property: "og:description", content: "Entra no GRIOT e liga-te ao teu ecossistema." },
    ],
  }),
  component: AuthPage,
});

type AuthMode = "otp" | "signin" | "signup";

function AuthPage() {
  const t = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Se o utilizador já tiver sessão válida no dispositivo, verifica os termos antes de avançar
  useEffect(() => {
    initNativeAuthDeepLink(() => {
      if (!checkTermsAccepted()) {
        setShowTerms(true);
      } else {
        void navigate({ to: "/home", replace: true });
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        if (!checkTermsAccepted()) {
          setShowTerms(true);
        } else {
          void navigate({ to: "/home", replace: true });
        }
      }
    });
  }, [navigate]);

  // Contagem decrescente para reenviar código OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handlePostLogin = (user: any) => {
    const userDisplayName =
      user?.user_metadata?.display_name ||
      user?.user_metadata?.name ||
      user?.user_metadata?.full_name ||
      user?.email?.split("@")[0] ||
      name ||
      "";

    if (typeof window !== "undefined") {
      if (user?.email) localStorage.setItem("griot_user_email", user.email);
      if (userDisplayName) localStorage.setItem("griot_user_name", userDisplayName);
    }

    toast.success(t("Sessão iniciada com sucesso!"));
    if (!checkTermsAccepted()) {
      setShowTerms(true);
    } else {
      void navigate({ to: "/home" });
    }
  };

  // Enviar código OTP de 6 dígitos
  async function handleSendOtp() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error(t("Por favor introduz um email válido"));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
      });

      if (error) throw error;

      setOtpSent(true);
      setResendCooldown(60);
      toast.success(t("Código de 6 dígitos enviado para o teu email!"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Erro ao enviar código. Tenta novamente."));
    } finally {
      setLoading(false);
    }
  }

  // Verificar código OTP de 6 dígitos
  async function handleVerifyOtp() {
    const cleanEmail = email.trim();
    const cleanToken = otpCode.trim();

    if (!cleanToken || cleanToken.length < 6) {
      toast.error(t("Por favor introduz o código de 6 dígitos"));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: "email",
      });

      if (error) throw error;

      if (data.session?.user) {
        handlePostLogin(data.session.user);
      } else {
        throw new Error(t("Código validado mas sem sessão. Tenta novamente."));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expired") || msg.includes("invalid") || msg.includes("Token")) {
        toast.error(t("Código incorreto ou expirado. Verifica no teu email."));
      } else {
        toast.error(msg || t("Erro ao verificar código."));
      }
    } finally {
      setLoading(false);
    }
  }

  // Login tradicional por Palavra-passe
  async function handlePasswordSignIn() {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      toast.error(t("Por favor introduz o teu email"));
      return;
    }
    if (!password) {
      toast.error(t("Por favor introduz a tua palavra-passe"));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) throw error;

      if (data.session?.user) {
        handlePostLogin(data.session.user);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid login credentials")) {
        toast.error(
          t(
            "Credenciais inválidas. Se ainda não criaste conta, clica em 'Criar Conta' ou usa o 'Código por Email'!",
          ),
          { duration: 5000 },
        );
      } else if (msg.includes("Email not confirmed")) {
        toast.error(
          t(
            "O teu email ainda não foi confirmado. Podes entrar de imediato usando a opção 'Código por Email'!",
          ),
          { duration: 6000 },
        );
      } else {
        toast.error(msg || t("Erro ao autenticar. Tenta novamente."));
      }
    } finally {
      setLoading(false);
    }
  }

  // Criar nova conta
  async function handleSignUp() {
    const cleanEmail = email.trim();
    const cleanName = name.trim();

    if (!cleanEmail) {
      toast.error(t("Por favor introduz o teu email"));
      return;
    }
    if (!password || password.length < 6) {
      toast.error(t("A palavra-passe deve ter pelo menos 6 caracteres"));
      return;
    }

    setLoading(true);
    try {
      const userDisplayName = cleanName || cleanEmail.split("@")[0] || "";

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            display_name: userDisplayName,
            name: userDisplayName,
            full_name: userDisplayName,
          },
        },
      });

      if (error) throw error;

      if (data.session?.user) {
        if (userDisplayName) {
          await (supabase as any).from("griot_user_profiles").upsert({
            id: data.session.user.id,
            display_name: userDisplayName,
            updated_at: new Date().toISOString(),
          });
        }
        handlePostLogin(data.session.user);
      } else if (data.user) {
        toast.success(
          t("Conta criada! Se o email exigir confirmação, enviámos o link para a tua caixa."),
          { duration: 6000 },
        );
        // Alterna para OTP para permitir entrada imediata por código se desejar
        setMode("otp");
        setOtpSent(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Erro ao criar conta."));
    } finally {
      setLoading(false);
    }
  }

  // Login Social (Google ou GitHub) com Deep Link nativo
  async function handleOAuth(provider: "google" | "github") {
    try {
      await startOAuthFlow(provider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("provider is not enabled") || msg.includes("validation_failed")) {
        toast.error(
          `O fornecedor ${provider === "google" ? "Google" : "GitHub"} precisa de ser ativado no teu painel Supabase (Authentication -> Providers). Usa o Código de 6 dígitos!`,
          { duration: 7000 },
        );
      } else {
        toast.error(msg || t("Erro ao iniciar sessão com o fornecedor."));
      }
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-12">
      <div className="rise">
        <GriotMark className="mx-auto size-24 rounded-[26px]" />
        <p className="mt-4 text-center text-[15px] font-medium text-foreground">
          {t("GRIOT Mobile")}
        </p>
        <p className="mt-1 text-center text-[13.5px] text-muted-foreground">
          {t("O teu ecossistema de inteligência, contigo.")}
        </p>

        {/* Seletor de Modo (Abas) */}
        <div className="mt-8 flex rounded-2xl bg-surface/80 p-1 border border-hairline">
          <button
            type="button"
            onClick={() => {
              setMode("otp");
              setOtpSent(false);
            }}
            className={`flex-1 rounded-xl py-2 text-[13.5px] font-medium transition-all ${
              mode === "otp"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("Código Email")}
          </button>
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`flex-1 rounded-xl py-2 text-[13.5px] font-medium transition-all ${
              mode === "signin"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("Password")}
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-xl py-2 text-[13.5px] font-medium transition-all ${
              mode === "signup"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("Criar Conta")}
          </button>
        </div>

        {/* Formulário Conforme Modo Selecionado */}
        <div className="mt-6 space-y-3">
          {/* MODO OTP (CÓDIGO DE 6 DÍGITOS) */}
          {mode === "otp" && (
            <>
              {!otpSent ? (
                <>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={t("O teu email (ex: esdraspuati3@gmail.com)")}
                      className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                    />
                  </div>

                  <p className="px-1 text-[12.5px] text-muted-foreground leading-relaxed">
                    {t("Recebes um código numérico de 6 dígitos no teu email para entrar de imediato sem password.")}
                  </p>

                  <button
                    onClick={() => void handleSendOtp()}
                    disabled={loading || !email.trim()}
                    className="mt-2 flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <span>{t("Enviar Código de 6 Dígitos")}</span>
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl bg-surface/60 px-3.5 py-2.5 border border-hairline text-[13px]">
                    <span className="font-mono text-foreground truncate max-w-[220px]">{email}</span>
                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="text-xs text-primary hover:underline"
                    >
                      {t("Alterar email")}
                    </button>
                  </div>

                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      placeholder="123456"
                      maxLength={6}
                      className="w-full rounded-2xl border border-primary/50 bg-surface pl-11 pr-4 py-3.5 text-center font-mono text-[20px] tracking-[0.3em] font-semibold outline-none focus:border-primary transition-colors"
                    />
                  </div>

                  <p className="px-1 text-[12.5px] text-muted-foreground text-center">
                    {t("Introduz o código de 6 dígitos que recebeste no teu email")}
                  </p>

                  <button
                    onClick={() => void handleVerifyOtp()}
                    disabled={loading || otpCode.trim().length < 6}
                    className="mt-2 flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="size-4" />
                        <span>{t("Confirmar e Entrar")}</span>
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      disabled={resendCooldown > 0 || loading}
                      onClick={() => void handleSendOtp()}
                      className="text-[12.5px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    >
                      {resendCooldown > 0
                        ? t(`Reenviar código em ${resendCooldown}s`)
                        : t("Não recebeste? Reenviar código")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* MODO SIGNIN (PASSWORD) */}
          {mode === "signin" && (
            <>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t("Email")}
                  className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder={t("Palavra-passe")}
                  className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                />
              </div>

              <button
                onClick={() => void handlePasswordSignIn()}
                disabled={loading || !email.trim() || !password}
                className="mt-2 flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : t("Entrar com Password")}
              </button>
            </>
          )}

          {/* MODO SIGNUP (CRIAR CONTA) */}
          {mode === "signup" && (
            <>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("O teu nome")}
                  className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                />
              </div>

              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t("Email")}
                  className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("Definir palavra-passe (mínimo 6 caracteres)")}
                  className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-primary transition-colors"
                />
              </div>

              <button
                onClick={() => void handleSignUp()}
                disabled={loading || !email.trim() || !password}
                className="mt-2 flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : t("Registar Conta")}
              </button>
            </>
          )}
        </div>

        {/* Divisor */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-[1px] flex-1 bg-hairline" />
          <span className="text-[12px] uppercase text-muted-foreground tracking-wider">
            {t("ou continuar com")}
          </span>
          <div className="h-[1px] flex-1 bg-hairline" />
        </div>

        {/* Botões Sociais */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* GitHub (Ativo no Supabase) */}
          <button
            type="button"
            onClick={() => void handleOAuth("github")}
            className="flex items-center justify-center gap-2 rounded-2xl border border-hairline bg-surface py-3 text-[14px] font-medium text-foreground transition-transform duration-200 active:scale-[0.98] hover:bg-surface/80"
          >
            <svg className="size-4" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            <span>GitHub</span>
          </button>

          {/* Google */}
          <button
            type="button"
            onClick={() => void handleOAuth("google")}
            className="flex items-center justify-center gap-2 rounded-2xl border border-hairline bg-surface py-3 text-[14px] font-medium text-foreground transition-transform duration-200 active:scale-[0.98] hover:bg-surface/80"
          >
            <svg className="size-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Google</span>
          </button>
        </div>
      </div>

      {showTerms && (
        <TermsDialog
          forceOpen
          allowDismiss={false}
          onClose={() => {
            setShowTerms(false);
            void navigate({ to: "/home" });
          }}
        />
      )}
    </div>
  );
}
