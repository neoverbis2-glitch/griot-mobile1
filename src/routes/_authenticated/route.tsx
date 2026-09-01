import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapWorkspace } from "@/lib/bootstrap";
import { TabBar } from "@/components/griot/tab-bar";

const ANONYMOUS_USER: User = {
  id: "anonymous",
  email: "",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
};

export const Route = createFileRoute("/_authenticated")({
  // Acesso aberto: a app abre direto no Home, sem passar pelo login.
  beforeLoad: async () => {
    try {
      const { data } = await supabase.auth.getUser();
      return {
        user: data?.user ?? ANONYMOUS_USER,
      };
    } catch {
      return {
        user: ANONYMOUS_USER,
      };
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();

  useEffect(() => {
    if (user?.id) void bootstrapWorkspace(user.id);
  }, [user?.id]);

  return (
    <>
      <Outlet />
      <TabBar />
    </>
  );
}
