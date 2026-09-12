/**
 * GRIOT Unified Project Service
 *
 * Fonte da verdade única para projetos no GRIOT Mobile.
 * Lê e sincroniza entre localStorage ('griot_local_projects') e Supabase ('griot_studio_projects').
 * Mantém o projeto ativo em 'griot_active_project_id' e emite eventos de atualização.
 */

import { supabase } from "@/integrations/supabase/client";

export interface GriotProject {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: string;
  created_at: string;
  updated_at?: string;
}

const STORAGE_PROJECTS_KEY = "griot_local_projects";
const STORAGE_ACTIVE_PROJECT_KEY = "griot_active_project_id";

/**
 * Obtém a lista unificada de projetos armazenados localmente e no Supabase.
 */
export async function getUnifiedProjects(): Promise<GriotProject[]> {
  let localList: GriotProject[] = [];
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (stored) {
        localList = JSON.parse(stored);
      }
    } catch (err) {
      console.warn("Erro ao ler projetos locais:", err);
    }
  }

  try {
    const { data: rawProjects } = await (supabase as any)
      .from("griot_studio_projects")
      .select("id, name, description, brief, archived, created_at, updated_at")
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (Array.isArray(rawProjects) && rawProjects.length > 0) {
      const remoteList: GriotProject[] = rawProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || p.brief?.goal || "Projeto GRIOT Studio",
        progress: typeof p.brief?.progress === "number" ? p.brief.progress : 0,
        status: p.brief?.build_status || "ativo",
        created_at: p.created_at,
        updated_at: p.updated_at,
      }));

      for (const rem of remoteList) {
        if (!localList.some((l) => l.id === rem.id)) {
          localList.push(rem);
        }
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(localList));
      }
    }
  } catch (err) {}

  return localList;
}

/**
 * Obtém os projetos síncronos da memória local para carregamento instantâneo.
 */
export function getLocalProjectsSync(): GriotProject[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_PROJECTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Obtém o projeto atualmente ativo.
 */
export function getActiveProjectSync(): GriotProject | null {
  const projects = getLocalProjectsSync();
  if (projects.length === 0) return null;

  if (typeof window !== "undefined") {
    const activeId = localStorage.getItem(STORAGE_ACTIVE_PROJECT_KEY);
    if (activeId) {
      const found = projects.find((p) => p.id === activeId);
      if (found) return found;
    }
  }

  return projects[0];
}

/**
 * Define o projeto ativo e notifica os componentes através de evento.
 */
export function setActiveProject(projectId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, projectId);
  window.dispatchEvent(new CustomEvent("griot-active-project-changed", { detail: projectId }));
}

/**
 * Guarda ou adiciona um novo projeto, definindo-o automaticamente como ativo.
 */
export async function saveProject(
  project: Partial<GriotProject> & { name: string },
): Promise<GriotProject> {
  const newProj: GriotProject = {
    id: project.id || `proj_${Date.now()}`,
    name: project.name.trim(),
    description: project.description?.trim() || "Projeto de automação GRIOT",
    progress: typeof project.progress === "number" ? project.progress : 0,
    status: project.status || "ativo",
    created_at: project.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const list = getLocalProjectsSync();
  const existingIdx = list.findIndex((p) => p.id === newProj.id);
  if (existingIdx >= 0) {
    list[existingIdx] = newProj;
  } else {
    list.unshift(newProj);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(list));
    localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, newProj.id);
    window.dispatchEvent(new CustomEvent("griot-active-project-changed", { detail: newProj.id }));
  }

  try {
    const { data: userAuth } = await supabase.auth.getUser();
    if (userAuth?.user) {
      await (supabase as any).from("griot_studio_projects").upsert({
        id: newProj.id,
        name: newProj.name,
        description: newProj.description,
        owner_id: userAuth.user.id,
        brief: {
          goal: newProj.name,
          stack: "REACT",
          progress: newProj.progress,
          build_status: newProj.status,
        },
        archived: false,
      });
    }
  } catch {}

  return newProj;
}
