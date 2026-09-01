import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { ChevronLeft, Plus } from "lucide-react";

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
        const { data } = await supabase
          .from("projects")
          .select("id, name, description, progress, status, created_at")
          .eq("id", projectId)
          .maybeSingle();

        if (cancelled) return;
        if (data) {
          setProject(data as unknown as ProjectDetail);
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
    <div className="min-h-screen bg-black text-white px-5 pt-[calc(env(safe-area-inset-top,0px)+24px)] pb-32">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void navigate({ to: "/projects" })}
            className="grid size-9 place-items-center rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 transition-transform active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-[34px] font-bold tracking-tight text-white">{project?.name || t("Projeto")}</h1>
        </div>
      </div>

      {/* Pill Tab Switcher Container */}
      <div className="mb-6 rounded-full border border-neutral-800/90 bg-[#141414] p-1.5 flex items-center justify-between">
        {(["tasks", "prs", "logs"] as const).map((tabKey) => {
          const label = tabKey === "tasks" ? "Tarefas" : tabKey === "prs" ? "PRs" : "Logs";
          const isActive = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`flex-1 rounded-full py-2.5 text-center text-[14.5px] font-medium transition-all duration-200 ${
                isActive
                  ? "bg-white text-black font-semibold shadow-sm"
                  : "text-neutral-400 hover:text-white"
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
            <div className="py-12 text-center text-neutral-500 text-[14px]">
              <p>{t("Sem tarefas registadas neste projeto.")}</p>
            </div>
          )}

          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => cycleTaskStatus(task.id)}
              className="flex cursor-pointer items-center justify-between rounded-[24px] border border-neutral-800/90 bg-[#121212] p-5 shadow-sm active:scale-[0.99] transition-transform"
            >
              <span className="text-[17px] font-bold text-white tracking-snug truncate pr-3">
                {task.title}
              </span>
              <span className="rounded-full bg-neutral-800/90 px-3 py-1 font-mono text-[12.5px] text-neutral-400 shrink-0">
                {task.status}
              </span>
            </div>
          ))}

          {addingTask ? (
            <div className="rounded-[24px] border border-neutral-800 bg-[#141414] p-4 rise">
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={t("Nome da tarefa")}
                className="w-full rounded-xl border border-neutral-800 bg-black px-4 py-2.5 text-[15px] text-white outline-none placeholder:text-neutral-500"
                autoFocus
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={addTask}
                  disabled={!newTaskTitle.trim()}
                  className="flex-1 rounded-xl bg-white py-2 text-[14px] font-medium text-black disabled:opacity-40"
                >
                  {t("Adicionar Tarefa")}
                </button>
                <button
                  onClick={() => setAddingTask(false)}
                  className="rounded-xl border border-neutral-800 px-4 py-2 text-[14px] text-neutral-400"
                >
                  {t("Cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingTask(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[24px] border border-dashed border-neutral-800 bg-black/40 py-3.5 text-[14.5px] font-medium text-neutral-400 active:scale-[0.98]"
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
            <div className="py-12 text-center text-neutral-500 text-[14px]">
              <p>{t("Sem Pull Requests registados.")}</p>
            </div>
          ) : (
            prs.map((pr) => (
              <div
                key={pr.id}
                className="rounded-[24px] border border-neutral-800/90 bg-[#121212] p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-bold text-white tracking-snug">{pr.title}</span>
                  <span className="rounded-full bg-neutral-800/90 px-3 py-1 font-mono text-[12.5px] text-neutral-400">
                    {pr.status}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-mono text-neutral-400">{pr.branch}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === "logs" && (
        <div className="rise rounded-[24px] border border-neutral-800/90 bg-[#121212] p-5 shadow-sm">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-neutral-500 text-[14px]">
              <p>{t("Sem registos de log para este projeto.")}</p>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={log.id}>
                {index > 0 && <div className="border-b border-neutral-800/60 my-4" />}
                <p className="text-[13px] text-neutral-400 font-mono mb-1">
                  {log.source} · {log.timeAgo}
                </p>
                <p className="text-[17px] font-bold text-white leading-snug">{log.message}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
