import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { ChevronRight, Plus, Check } from "lucide-react";
import {
  getUnifiedProjects,
  getActiveProjectSync,
  setActiveProject,
  saveProject,
  type GriotProject,
} from "@/lib/project-service";

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
  const [projects, setProjects] = useState<GriotProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      try {
        const unified = await getUnifiedProjects();
        if (cancelled) return;
        setProjects(unified);
        const active = getActiveProjectSync();
        setActiveProjectId(active?.id || unified[0]?.id || null);
      } catch (err) {
        console.warn("Carregamento de projetos:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProjects();

    const handleActiveChanged = (e: any) => {
      setActiveProjectId(e.detail);
    };
    window.addEventListener("griot-active-project-changed", handleActiveChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("griot-active-project-changed", handleActiveChanged);
    };
  }, []);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;

    try {
      const created = await saveProject({ name });
      const updated = [created, ...projects.filter((p) => p.id !== created.id)];
      setProjects(updated);
      setActiveProjectId(created.id);
      toast.success(t("Projeto criado com sucesso!"));
      setNewProjectName("");
      setCreating(false);
    } catch {
      toast.error(t("Não foi possível criar o projeto."));
    }
  }
        status: "ativo",
        created_at: new Date().toISOString(),
      };

      const { data: userAuth } = await supabase.auth.getUser();
      if (userAuth?.user) {
        await (supabase as any).from("griot_studio_projects").insert({
          name: newProj.name,
          description: newProj.description,
          owner_id: userAuth.user.id,
          brief: { goal: newProj.name, stack: "REACT", audience: "USUÁRIOS REAIS" },
          archived: false,
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
                    <div className="flex items-center gap-2">
                      <h2 className="text-[20px] font-bold text-white tracking-snug">{proj.name}</h2>
                      {proj.id === activeProjectId && (
                        <span className="rounded-full bg-white/15 border border-white/20 px-2 py-0.5 text-[10.5px] font-semibold text-white tracking-wide uppercase">
                          {t("Ativo")}
                        </span>
                      )}
                    </div>
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
