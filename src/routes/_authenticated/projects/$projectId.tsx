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
} from "@/lib/project-service";
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

const DEFAULT_STARTER_TASKS: TaskRow[] = [
  { id: "t_1", title: "Configuração do repositório e ambiente", status: "done" },
  { id: "t_2", title: "Definição do escopo e arquitetura do app", status: "done" },
  { id: "t_3", title: "Desenvolvimento dos módulos centrais", status: "doing" },
  { id: "t_4", title: "Testes automatizados e compilação", status: "todo" },
];

const DEFAULT_PRS: PrRow[] = [
  { id: "pr_1", title: "feat: setup de arquitetura do projeto", branch: "feat/core", status: "merged" },
  { id: "pr_2", title: "fix: sincronização offline e persistência", branch: "fix/sync", status: "open" },
];

const DEFAULT_LOGS: LogRow[] = [
  { id: "log_1", source: "BUILD", timeAgo: "há 5m", message: "Ambiente do projeto verificado e pronto" },
  { id: "log_2", source: "SYNC", timeAgo: "há 10m", message: "Workspace sincronizado com storage local" },
];

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
    const saved = getProjectTasks(projectId);
    return saved.length > 0 ? saved : DEFAULT_STARTER_TASKS;
  });
  const [prs, setPrs] = useState<PrRow[]>(DEFAULT_PRS);
  const [logs, setLogs] = useState<LogRow[]>(DEFAULT_LOGS);

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
    } else {
      setTasks(DEFAULT_STARTER_TASKS);
      saveProjectTasks(projectId, DEFAULT_STARTER_TASKS);
    }

    let cancelled = false;
    async function loadDetail() {
      try {
        const [projectRes, tasksRes, opbEventsRes] = await Promise.all([
          (supabase as any)
            .from("griot_studio_projects")
            .select("id, name, description, brief, created_at, updated_at")
            .eq("id", projectId)
            .maybeSingle(),
          (supabase as any)
            .from("griot_studio_tasks")
            .select("id, title, status, created_at")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false }),
          (supabase as any)
            .from("griot_opb_events")
            .select("id, event_type, payload, created_at")
            .order("created_at", { ascending: false })
            .limit(10),
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

        const dbTasks = tasksRes?.data;
        if (dbTasks && dbTasks.length > 0) {
          const mapped: TaskRow[] = dbTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            status:
              t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : "todo",
          }));
          setTasks(mapped);
          saveProjectTasks(projectId, mapped);
        }

        const opbLogs = opbEventsRes?.data;
        if (opbLogs && opbLogs.length > 0) {
          setLogs(
            opbLogs.map((e: any) => ({
              id: e.id,
              source: "OPB",
              timeAgo: relativeTime(e.created_at),
              message: `${e.event_type.replace(/_/g, " ")}: ${e.payload?.receiptId || e.payload?.messageId || "processado"}`,
            })),
          );
        }
      } catch (err) {
        console.warn("Carregamento do projeto:", err);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function addTask() {
    if (!newTaskTitle.trim()) return;
    const updated: TaskRow[] = [
      ...tasks,
      { id: `t_${Date.now()}`, title: newTaskTitle.trim(), status: "todo" },
    ];
    setTasks(updated);
    saveProjectTasks(projectId, updated);
    setNewTaskTitle("");
    setAddingTask(false);
    toast.success(t("Tarefa adicionada!"));
  }

  function cycleTaskStatus(id: string) {
    const updated = tasks.map((task) => {
      if (task.id !== id) return task;
      const nextStatus: "todo" | "doing" | "done" =
        task.status === "todo" ? "doing" : task.status === "doing" ? "done" : "todo";
      return { ...task, status: nextStatus };
    });
    setTasks(updated);
    saveProjectTasks(projectId, updated);
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
          {prs.map((pr) => (
            <div
              key={pr.id}
              className="rounded-[22px] border border-hairline bg-surface p-4 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15.5px] font-semibold text-foreground tracking-snug">
                  {pr.title}
                </span>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
                  {pr.status}
                </span>
              </div>
              <p className="mt-1.5 text-[12.5px] font-mono text-muted-foreground">{pr.branch}</p>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === "logs" && (
        <div className="rise rounded-[22px] border border-hairline bg-surface p-4 shadow-xs space-y-3">
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
