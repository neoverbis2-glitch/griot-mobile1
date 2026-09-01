import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GriotMark } from "@/components/griot/logo";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Mail, Lock, User as UserIcon, Sparkles } from "lucide-react";

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

function AuthPage() {
  const t = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "magic_link">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!email.trim()) {
      toast.error(t("Por favor introduz o teu email"));
      return;
    }

    setLoading(true);

    try {
      if (mode === "magic_link") {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: window.location.origin + "/home",
          },
        });
        if (error) throw error;
        toast.success(t("Link de acesso enviado para o teu email!"));
        return;
      }

      if (mode === "signup") {
        if (!password || password.length < 6) {
          toast.error(t("A palavra-passe deve ter pelo menos 6 caracteres"));
          setLoading(false);
          return;
        }

        const trimmedName = name.trim();
        const trimmedEmail = email.trim();
        const userDisplayName = trimmedName || trimmedEmail.split("@")[0] || "";

        if (typeof window !== "undefined") {
          if (userDisplayName) localStorage.setItem("griot_user_name", userDisplayName);
          localStorage.setItem("griot_user_email", trimmedEmail);
        }

        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
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

        if (data.user) {
          if (userDisplayName) {
            await (supabase as any).from("griot_user_profiles").upsert({
              id: data.user.id,
              display_name: userDisplayName,
              updated_at: new Date().toISOString(),
            });
          }
          toast.success(t("Conta criada com sucesso!"));
          void navigate({ to: "/home" });
        } else {
          toast.info(t("Verifica o teu email para confirmar a conta."));
        }
        return;
      }

      // Sign In
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (data.session) {
        const currentUser = data.session.user;
        const userDisplayName =
          currentUser.user_metadata?.display_name ||
          currentUser.user_metadata?.name ||
          currentUser.user_metadata?.full_name ||
          currentUser.email?.split("@")[0] ||
          "";

        if (typeof window !== "undefined") {
          if (currentUser.email) {
            localStorage.setItem("griot_user_email", currentUser.email);
          }
          if (userDisplayName) {
            localStorage.setItem("griot_user_name", userDisplayName);
          }
        }
        toast.success(t("Sessão iniciada!"));
        void navigate({ to: "/home" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || t("Erro ao autenticar. Tenta novamente."));
    } finally {
      setLoading(false);
    }
  }

  function continueAsGuest() {
    void navigate({ to: "/home" });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-12">
      <div className="rise">
        <GriotMark className="mx-auto size-24 rounded-[26px]" />
        <p className="mt-6 text-center text-[15px] text-muted-foreground">
          {t("O teu ecossistema, contigo.")}
        </p>

        <div className="mt-10 space-y-3">
          {mode === "signup" ? (
            <div className="relative">
              <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Nome")}
                className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15.5px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}

          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("Email")}
              className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15.5px] outline-none placeholder:text-muted-foreground"
            />
          </div>

          {mode !== "magic_link" ? (
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={t("Palavra-passe")}
                className="w-full rounded-2xl border border-hairline bg-surface pl-11 pr-4 py-3.5 text-[15.5px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}
        </div>

        <button
          onClick={() => void handleAuth()}
          disabled={loading}
          className="mt-4 flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-3.5 text-[15.5px] font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : mode === "signin" ? (
            t("Entrar")
          ) : mode === "signup" ? (
            t("Criar conta")
          ) : (
            t("Enviar Magic Link")
          )}
        </button>

        <button
          type="button"
          onClick={() => void supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/home" } })}
          className="mt-2.5 flex items-center justify-center gap-2.5 w-full rounded-2xl border border-hairline bg-surface py-3.5 text-[15px] font-medium text-foreground transition-transform duration-200 active:scale-[0.98]"
        >
          <svg className="size-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          {t("Entrar com o Google")}
        </button>

        <button
          onClick={continueAsGuest}
          className="mt-2.5 w-full rounded-2xl border border-hairline py-3.5 text-[15.5px] font-medium transition-transform duration-200 active:scale-[0.98]"
        >
          {t("Continuar em modo local")}
        </button>

        <div className="mt-6 flex flex-col gap-2 text-center text-[13.5px] text-muted-foreground">
          {mode === "signin" ? (
            <>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="hover:text-foreground transition-colors"
              >
                {t("Ainda não tenho conta — Criar conta")}
              </button>
              <button
                type="button"
                onClick={() => setMode("magic_link")}
                className="inline-flex items-center justify-center gap-1.5 hover:text-foreground transition-colors"
              >
                <Sparkles className="size-3.5" />
                {t("Entrar com Magic Link (sem password)")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="hover:text-foreground transition-colors"
            >
              {t("Já tenho conta — Entrar")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
