import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-user";
import { bootstrapWorkspace } from "@/lib/bootstrap";
import { TabBar } from "@/components/griot/tab-bar";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = useCurrentUser();

  useEffect(() => {
    if (user?.id && user.id !== "anonymous") {
      void bootstrapWorkspace(user.id).catch(() => null);
    }
  }, [user?.id]);

  return (
    <>
      <Outlet />
      <TabBar />
    </>
  );
}
