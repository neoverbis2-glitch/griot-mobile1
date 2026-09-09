import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { ChevronLeft, Plus, MessageSquare } from "lucide-react";
import { setActiveProject } from "@/lib/project-service";

type ProjectDetail = {
  id: string;
  name: string;
  description?: string | null;
  progress?: number | null;
  status?: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
};

type PrRow = {
  id: string;
  title: string;
  branch: string;
  status: string;
};

type LogRow = {
  id: string;
  source: string;
  timeAgo: string;
  message: string;
};

type ProjectTab = "tasks" | "prs" | "logs";

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
  const { projectId } = Route.useParams();
  const t = useT();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>("tasks");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [prs, setPrs] = useState<PrRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  useEffect(() => {
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
        } else {
          const stored = typeof window !== "undefined" ? localStorage.getItem("griot_local_projects") : null;
          if (stored) {
            const list: ProjectDetail[] = JSON.parse(stored);
            const found = list.find((p) => p.id === projectId);
            if (found) setProject(found);
          }

          if (!project) {
            setProject({
              id: projectId,
              name: t("Projeto"),
              description: t("Projeto do workspace GRIOT"),
              progress: 0,
              status: "ativo",
              created_at: new Date().toISOString(),
            });
          }
        }

        const dbTasks = tasksRes?.data;
        if (dbTasks && dbTasks.length > 0) {
          setTasks(
            dbTasks.map((t: any) => ({
              id: t.id,
              title: t.title,
              status: t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : "todo",
            })),
          );
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
      if (projectId) {
        setActiveProject(projectId);
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function addTask() {
    if (!newTaskTitle.trim()) return;
    const updated = [
      ...tasks,
      { id: `t_${Date.now()}`, title: newTaskTitle.trim(), status: "todo" as const },
    ];
    setTasks(updated);
    setNewTaskTitle("");
    setAddingTask(false);
    toast.success(t("Tarefa adicionada!"));
  }

  function cycleTaskStatus(id: string) {
    setTasks(
      tasks.map((task) => {
        if (task.id !== id) return task;
        const nextStatus =
          task.status === "todo" ? "doing" : task.status === "doing" ? "done" : "todo";
        return { ...task, status: nextStatus };
      }),
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground px-5 pt-[calc(env(safe-area-inset-top,0px)+24px)] pb-32">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void navigate({ to: "/projects" })}
            className="grid size-9 place-items-center rounded-full bg-secondary border border-hairline text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-[34px] font-bold tracking-tight text-foreground">{project?.name || t("Projeto")}</h1>
        </div>

        <button
          onClick={() => {
            setActiveProject(projectId);
            void navigate({ to: "/chat" });
          }}
          className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3.5 py-1.5 text-[13px] font-semibold text-foreground transition-transform active:scale-95"
        >
          <MessageSquare className="size-3.5" />
          <span>{t("Chat")}</span>
        </button>
      </div>

      {/* Pill Tab Switcher Container */}
      <div className="mb-6 rounded-full border border-hairline bg-surface p-1.5 flex items-center justify-between">
        {(["tasks", "prs", "logs"] as const).map((tabKey) => {
          const label = tabKey === "tasks" ? "Tarefas" : tabKey === "prs" ? "PRs" : "Logs";
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
          {tasks.length === 0 && !addingTask && (
            <div className="py-12 text-center text-muted-foreground text-[14px]">
              <p>{t("Sem tarefas registadas neste projeto.")}</p>
            </div>
          )}

          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => cycleTaskStatus(task.id)}
              className="flex cursor-pointer items-center justify-between rounded-[24px] border border-hairline bg-surface p-5 shadow-xs active:scale-[0.99] transition-transform"
            >
              <span className="text-[17px] font-bold text-foreground tracking-snug truncate pr-3">
                {task.title}
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 font-mono text-[12.5px] text-muted-foreground shrink-0">
                {task.status}
              </span>
            </div>
          ))}

          {addingTask ? (
            <div className="rounded-[24px] border border-hairline bg-surface p-4 rise">
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
              className="flex w-full items-center justify-center gap-2 rounded-[24px] border border-dashed border-hairline bg-surface/50 py-3.5 text-[14.5px] font-medium text-muted-foreground active:scale-[0.98]"
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
          {prs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-[14px]">
              <p>{t("Sem Pull Requests registados.")}</p>
            </div>
          ) : (
            prs.map((pr) => (
              <div
                key={pr.id}
                className="rounded-[24px] border border-hairline bg-surface p-5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-bold text-foreground tracking-snug">{pr.title}</span>
                  <span className="rounded-full bg-secondary px-3 py-1 font-mono text-[12.5px] text-muted-foreground">
                    {pr.status}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-mono text-muted-foreground">{pr.branch}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === "logs" && (
        <div className="rise rounded-[24px] border border-hairline bg-surface p-5 shadow-xs">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-[14px]">
              <p>{t("Sem registos de log para este projeto.")}</p>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={log.id}>
                {index > 0 && <div className="border-b border-hairline my-4" />}
                <p className="text-[13px] text-muted-foreground font-mono mb-1">
                  {log.source} · {log.timeAgo}
                </p>
                <p className="text-[17px] font-bold text-foreground leading-snug">{log.message}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
