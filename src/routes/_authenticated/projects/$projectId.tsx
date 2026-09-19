import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { ChevronLeft, Plus, MessageSquare, Trash2 } from "lucide-react";
import {
  setActiveProject,
  deleteProject,
  getLocalProjectsSync,
  getProjectTasks,
  saveProjectTasks,
  fetchProjectTasksFromDb,
  createProjectTaskInDb,
  updateProjectTaskStatusInDb,
  fetchProjectRepositoryBinding,
  fetchProjectComputeRuns,
  fetchProjectOpbEvents,
} from "@/lib/project-service";
import { getConnectedPlugins } from "@/lib/plugins-service";
import { ConfirmationModal } from "@/components/griot/confirmation-modal";

export type ProjectDetail = {
  id: string;
  name: string;
  description?: string | null;
  progress?: number | null;
  status?: string | null;
  created_at: string;
};

export type TaskRow = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
};

export type PrRow = {
  id: string;
  title: string;
  branch: string;
  status: string;
};

export type LogRow = {
  id: string;
  source: string;
  timeAgo: string;
  message: string;
};

function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return "recentemente";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `há ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    return `há ${days}d`;
  } catch {
    return "recentemente";
  }
}

type ProjectTab = "tasks" | "prs" | "logs";

export interface ProjectDetailViewProps {
  projectId: string;
  onBack?: () => void;
  onDeleted?: (deletedId: string) => void;
}

export function ProjectDetailView({ projectId, onBack, onDeleted }: ProjectDetailViewProps) {
  const t = useT();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(() => {
    if (typeof window === "undefined") return null;
    const local = getLocalProjectsSync().find((p) => p.id === projectId);
    if (local) return local;
    return null;
  });

  const [activeTab, setActiveTab] = useState<ProjectTab>("tasks");
  const [tasks, setTasks] = useState<TaskRow[]>(() => {
    return getProjectTasks(projectId);
  });
  const [prs, setPrs] = useState<PrRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [repoBinding, setRepoBinding] = useState<any | null>(null);

  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setActiveProject(projectId);

    // Carregar do localStorage imediatamente
    const local = getLocalProjectsSync().find((p) => p.id === projectId);
    if (local) {
      setProject(local);
    }

    const savedTasks = getProjectTasks(projectId);
    if (savedTasks.length > 0) {
      setTasks(savedTasks);
    }

    let cancelled = false;
    async function loadDetail() {
      try {
        const [projectRes, dbTasks, binding, computeRuns, opbEvents] = await Promise.all([
          (supabase as any)
            .from("griot_studio_projects")
            .select("id, name, description, brief, created_at, updated_at")
            .eq("id", projectId)
            .maybeSingle(),
          fetchProjectTasksFromDb(projectId),
          fetchProjectRepositoryBinding(projectId),
          fetchProjectComputeRuns(projectId),
          fetchProjectOpbEvents(projectId),
        ]);

        if (cancelled) return;

        const data = projectRes?.data;
        if (data) {
          setProject({
            id: data.id,
            name: data.name,
            description: data.description || data.brief?.goal || "Projeto GRIOT Studio",
            progress: typeof data.brief?.progress === "number" ? data.brief.progress : 85,
            status: data.brief?.build_status || "ativo",
            created_at: data.created_at,
          });
        }

        // Tarefas Reais do Supabase
        if (Array.isArray(dbTasks)) {
          setTasks(dbTasks);
        }

        // Repositório e Pull Requests Reais
        setRepoBinding(binding);
        if (binding?.repository_full_name) {
          try {
            const plugins = getConnectedPlugins();
            const ghToken = plugins["github"]?.apiKey || "";
            const headers: Record<string, string> = {
              Accept: "application/vnd.github.v3+json",
            };
            if (ghToken) {
              headers.Authorization = `Bearer ${ghToken}`;
            }

            const response = await fetch(
              `https://api.github.com/repos/${binding.repository_full_name}/pulls?state=all&per_page=15`,
              { headers },
            );

            if (response.ok) {
              const pullRequests = await response.json();
              if (Array.isArray(pullRequests)) {
                setPrs(
                  pullRequests.map((pr: any) => ({
                    id: String(pr.id || pr.number),
                    title: pr.title || `PR #${pr.number}`,
                    branch: pr.head?.ref || binding.default_branch || "main",
                    status: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed",
                  })),
                );
              }
            } else {
              setPrs([]);
            }
          } catch (ghErr) {
            console.warn("Erro ao buscar PRs do GitHub:", ghErr);
            setPrs([]);
          }
        } else {
          setPrs([]);
        }

        // Logs Reais do GRIOT Sandbox e OPB
        const allLogs: LogRow[] = [];

        if (Array.isArray(computeRuns)) {
          for (const run of computeRuns) {
            const providerName =
              run.provider === "container" || run.provider === "griot_sandbox"
                ? "GRIOT SANDBOX"
                : run.provider.toUpperCase();
            const refText =
              run.repository_ref ||
              (run.source_commit_sha ? run.source_commit_sha.slice(0, 7) : "");
            allLogs.push({
              id: `run_${run.id}`,
              source: providerName,
              timeAgo: relativeTime(run.created_at),
              message: `Execução ${run.status}${refText ? ` (${refText})` : ""}: ${run.internal_run_id?.slice(0, 8) || "run"}`,
            });
          }
        }

        if (Array.isArray(opbEvents)) {
          for (const e of opbEvents) {
            allLogs.push({
              id: `opb_${e.id}`,
              source: "OPB",
              timeAgo: relativeTime(e.created_at),
              message: `${e.event_type.replace(/_/g, " ")}: ${e.payload?.receiptId || e.payload?.messageId || "processado"}`,
            });
          }
        }

        setLogs(allLogs);
      } catch (err) {
        console.warn("Carregamento do projeto:", err);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function addTask() {
    if (!newTaskTitle.trim()) return;
    const title = newTaskTitle.trim();
    setNewTaskTitle("");
    setAddingTask(false);

    // Adição otimista imediata
    const tempId = `t_${Date.now()}`;
    const optimTask: TaskRow = { id: tempId, title, status: "todo" };
    const updated = [optimTask, ...tasks];
    setTasks(updated);
    saveProjectTasks(projectId, updated);
    toast.success(t("Tarefa adicionada!"));

    // Persistência real no Supabase
    try {
      const created = await createProjectTaskInDb(projectId, title);
      if (created) {
        setTasks((prev) =>
          prev.map((item) => (item.id === tempId ? { ...item, id: created.id } : item)),
        );
      }
    } catch (err) {
      console.warn("Erro ao persistir tarefa no Supabase:", err);
    }
  }

  function cycleTaskStatus(id: string) {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;

    const nextStatus: "todo" | "doing" | "done" =
      target.status === "todo" ? "doing" : target.status === "doing" ? "done" : "todo";

    const updated = tasks.map((task) => {
      if (task.id !== id) return task;
      return { ...task, status: nextStatus };
    });
    setTasks(updated);
    saveProjectTasks(projectId, updated);

    // Atualização real em griot_studio_tasks
    void updateProjectTaskStatusInDb(id, nextStatus);
  }

  async function handleDeleteConfirm() {
    setIsDeleting(true);
    try {
      await deleteProject(projectId);
      toast.success(t("Projeto eliminado com sucesso!"));
      setShowDeleteModal(false);
      if (onDeleted) {
        onDeleted(projectId);
      } else if (onBack) {
        onBack();
      } else {
        void navigate({ to: "/projects" });
      }
    } catch {
      toast.error(t("Erro ao eliminar o projeto."));
    } finally {
      setIsDeleting(false);
    }
  }

  const prog = Math.min(100, Math.max(0, Number(project?.progress ?? 0)));

  return (
    <div className="min-h-screen bg-background text-foreground px-5 pt-[calc(env(safe-area-inset-top,0px)+24px)] pb-32">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onBack || (() => void navigate({ to: "/projects" }))}
            aria-label={t("Voltar aos Projetos")}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary border border-hairline text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="truncate min-w-0 flex-1 text-[24px] sm:text-[30px] font-bold tracking-tight text-foreground leading-snug py-0.5">
            {project?.name || t("Projeto")}
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setActiveProject(projectId);
              void navigate({ to: "/chat" });
            }}
            className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-transform active:scale-95"
          >
            <MessageSquare className="size-3.5" />
            <span>{t("Chat")}</span>
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            aria-label={t("Eliminar projeto")}
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-hairline transition-all active:scale-90"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Project Overview Card */}
      <div className="mb-6 rounded-[22px] border border-hairline bg-surface p-4 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold tracking-wider text-muted-foreground uppercase">
            {project?.status || t("Ativo")}
          </span>
          <span className="text-[14px] font-bold text-foreground tabular-nums">
            {prog}%
          </span>
        </div>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground font-normal line-clamp-2">
          {project?.description || t("Projeto de automação GRIOT Mobile")}
        </p>
        <div className="mt-3.5 h-[3.5px] w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${prog}%` }}
          />
        </div>
      </div>

      {/* Pill Tab Switcher Container */}
      <div className="mb-6 rounded-full border border-hairline bg-surface p-1.5 flex items-center justify-between">
        {(["tasks", "prs", "logs"] as const).map((tabKey) => {
          const label = tabKey === "tasks" ? t("Tarefas") : tabKey === "prs" ? "PRs" : "Logs";
          const isActive = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`flex-1 rounded-full py-2.5 text-center text-[14.5px] font-medium transition-all duration-200 ${
                isActive
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: TAREFAS */}
      {activeTab === "tasks" && (
        <div className="space-y-3 rise">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => cycleTaskStatus(task.id)}
              className="flex cursor-pointer items-center justify-between rounded-[22px] border border-hairline bg-surface p-4 shadow-xs active:scale-[0.99] transition-transform"
            >
              <span className="text-[15.5px] font-semibold text-foreground tracking-snug truncate pr-3">
                {task.title}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider shrink-0 ${
                  task.status === "done"
                    ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/20"
                    : task.status === "doing"
                    ? "bg-amber-500/15 text-amber-500 border border-amber-500/20"
                    : "bg-secondary text-muted-foreground border border-hairline"
                }`}
              >
                {task.status}
              </span>
            </div>
          ))}

          {tasks.length === 0 && (
            <div className="rounded-[22px] border border-hairline bg-surface p-6 text-center text-muted-foreground text-[14px]">
              {t("Nenhuma tarefa criada para este projeto.")}
            </div>
          )}

          {addingTask ? (
            <div className="rounded-[22px] border border-hairline bg-surface p-4 rise">
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={t("Nome da tarefa")}
                className="w-full rounded-xl border border-hairline bg-background px-4 py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={addTask}
                  disabled={!newTaskTitle.trim()}
                  className="flex-1 rounded-xl bg-primary py-2 text-[14px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  {t("Adicionar Tarefa")}
                </button>
                <button
                  onClick={() => setAddingTask(false)}
                  className="rounded-xl border border-hairline px-4 py-2 text-[14px] text-muted-foreground"
                >
                  {t("Cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingTask(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[22px] border border-dashed border-hairline bg-surface/50 py-3 text-[14px] font-medium text-muted-foreground active:scale-[0.98]"
            >
              <Plus className="size-4" />
              {t("Adicionar Tarefa")}
            </button>
          )}
        </div>
      )}

      {/* TAB 2: PRs */}
      {activeTab === "prs" && (
        <div className="space-y-3 rise">
          {repoBinding && (
            <div className="flex items-center justify-between rounded-[22px] border border-hairline bg-surface/60 px-4 py-2.5 text-[12.5px] font-mono text-muted-foreground">
              <span className="truncate">📦 {repoBinding.repository_full_name}</span>
              <span className="shrink-0 text-[11px] rounded-full bg-secondary px-2 py-0.5 font-semibold">
                {repoBinding.default_branch || repoBinding.ref || "main"}
              </span>
            </div>
          )}
          {prs.length === 0 ? (
            <div className="rounded-[22px] border border-hairline bg-surface p-6 text-center text-muted-foreground text-[14px]">
              {repoBinding
                ? t("Nenhum Pull Request aberto ou fechado neste repositório.")
                : t("Nenhum repositório GitHub vinculado a este projeto.")}
            </div>
          ) : (
            prs.map((pr) => (
              <div
                key={pr.id}
                className="rounded-[22px] border border-hairline bg-surface p-4 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15.5px] font-semibold text-foreground tracking-snug">
                    {pr.title}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider shrink-0 ${
                      pr.status === "merged"
                        ? "bg-purple-500/15 text-purple-400 border border-purple-500/20"
                        : pr.status === "open"
                        ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/20"
                        : "bg-secondary text-muted-foreground border border-hairline"
                    }`}
                  >
                    {pr.status}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] font-mono text-muted-foreground">{pr.branch}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === "logs" && (
        <div className="space-y-3 rise">
          {logs.length === 0 ? (
            <div className="rounded-[22px] border border-hairline bg-surface p-6 text-center text-muted-foreground text-[14px]">
              {t("Nenhum registo de execução encontrado para este projeto.")}
            </div>
          ) : (
            <div className="rounded-[22px] border border-hairline bg-surface p-4 shadow-xs space-y-3">
              {logs.map((log, index) => (
                <div key={log.id}>
                  {index > 0 && <div className="border-b border-hairline my-3" />}
                  <p className="text-[12px] text-muted-foreground font-mono mb-1">
                    {log.source} · {log.timeAgo}
                  </p>
                  <p className="text-[15px] font-semibold text-foreground leading-snug">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal to Delete Project */}
      <ConfirmationModal
        open={showDeleteModal}
        title={t("Eliminar Projeto")}
        description={t(
          `Tens a certeza que desejas eliminar permanentemente o projeto "${project?.name || ""}"? Esta ação não pode ser desfeita.`,
        )}
        confirmLabel={isDeleting ? t("A eliminar...") : t("Eliminar")}
        cancelLabel={t("Cancelar")}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Projeto — GRIOT Mobile" },
      {
        name: "description",
        content: "Detalhes do Projeto",
      },
    ],
  }),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const projectId = params?.projectId || "";

  return (
    <ProjectDetailView
      projectId={projectId}
      onBack={() => void navigate({ to: "/projects" })}
      onDeleted={() => void navigate({ to: "/projects" })}
    />
  );
}
