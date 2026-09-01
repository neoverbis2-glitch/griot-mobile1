import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { ChevronRight, Plus } from "lucide-react";

type ProjectRow = {
  id: string;
  name: string;
  description?: string | null;
  progress?: number | null;
  status?: string | null;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — GRIOT Mobile" },
      {
        name: "description",
        content: "Projetos do GRIOT Mobile",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const t = useT();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      try {
        const { data } = await supabase
          .from("projects")
          .select("id, name, description, progress, status, created_at")
          .order("created_at", { ascending: false });

        if (cancelled) return;
        if (data && data.length > 0) {
          setProjects(data as unknown as ProjectRow[]);
        } else {
          // Limpo por padrão para produção real
          const stored = typeof window !== "undefined" ? localStorage.getItem("griot_local_projects") : null;
          if (stored) {
            setProjects(JSON.parse(stored));
          } else {
            setProjects([]);
          }
        }
      } catch (err) {
        console.warn("Carregamento de projetos:", err);
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;

    try {
      const newProj: ProjectRow = {
        id: `proj_${Date.now()}`,
        name,
        description: "Projeto de automação GRIOT",
        progress: 0,
        status: "ativo",
        created_at: new Date().toISOString(),
      };

      const { data: userAuth } = await supabase.auth.getUser();
      if (userAuth?.user) {
        await supabase.from("projects").insert({
          id: newProj.id,
          name: newProj.name,
          user_id: userAuth.user.id,
        }).catch(() => null);
      }

      const updated = [newProj, ...projects];
      setProjects(updated);
      if (typeof window !== "undefined") {
        localStorage.setItem("griot_local_projects", JSON.stringify(updated));
      }

      toast.success(t("Projeto criado com sucesso!"));
      setNewProjectName("");
      setCreating(false);
    } catch {
      toast.error(t("Não foi possível criar o projeto."));
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-5 pt-[calc(env(safe-area-inset-top,0px)+24px)] pb-32">
      {/* Header Matching Screenshots */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[34px] font-bold tracking-tight text-white">Projects</h1>
        <button
          onClick={() => setCreating(!creating)}
          aria-label="Novo Projeto"
          className="grid size-9 place-items-center rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 transition-transform active:scale-95"
        >
          <Plus className="size-5" />
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-[24px] border border-neutral-800 bg-[#141414] p-4 rise">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder={t("Nome do Projeto")}
            className="w-full rounded-xl border border-neutral-800 bg-black px-4 py-2.5 text-[15px] text-white outline-none placeholder:text-neutral-500"
            autoFocus
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void handleCreateProject()}
              disabled={!newProjectName.trim()}
              className="flex-1 rounded-xl bg-white py-2 text-[14px] font-medium text-black disabled:opacity-40"
            >
              {t("Criar Projeto")}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-xl border border-neutral-800 px-4 py-2 text-[14px] text-neutral-400"
            >
              {t("Cancelar")}
            </button>
          </div>
        </div>
      )}

      {/* Clean State for Real Production */}
      {loading ? (
        <div className="py-12 text-center text-neutral-500 text-[14px]">{t("A carregar...")}</div>
      ) : projects.length === 0 ? (
        <div className="py-16 text-center text-neutral-500 text-[15px]">
          <p>{t("Ainda não tens projetos.")}</p>
          <p className="mt-1 text-[13px] text-neutral-600">
            {t("Cria um novo projeto acima ou converte um veredito no Quick Chat.")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((proj) => {
            const prog = Math.min(100, Math.max(0, Number(proj.progress ?? 0)));
            return (
              <Link
                key={proj.id}
                to="/projects/$projectId"
                params={{ projectId: proj.id }}
                className="block active:opacity-90"
              >
                <div className="rounded-[24px] border border-neutral-800/90 bg-[#121212] p-5 shadow-sm transition-transform active:scale-[0.99]">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[20px] font-bold text-white tracking-snug">{proj.name}</h2>
                    <div className="flex items-center gap-1 text-[17px] font-bold text-white">
                      <span>{prog}%</span>
                      <ChevronRight className="size-4 text-neutral-400" />
                    </div>
                  </div>

                  <p className="mt-1.5 text-[13.5px] text-neutral-400 font-normal line-clamp-1">
                    {proj.description || t("Projeto de automação GRIOT Mobile")}
                  </p>

                  <div className="mt-4 h-[3.5px] w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-500"
                      style={{ width: `${prog}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
