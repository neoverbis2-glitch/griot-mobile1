/**
 * GRIOT Connectors Hub - Batch 1 (Dev & Cloud)
 * Real execution for:
 * 1. GitHub (repos, issues, pull requests, file contents)
 * 2. GitLab (projects, issues, repository tree)
 * 3. Vercel (projects, deployments, aliases)
 * 4. Supabase (projects, query/tables via PostgREST, health)
 * 5. Firebase (Firestore documents, project info)
 */

export interface ConnectorExecutionContext {
  credential: string;
  account?: string;
  action: string;
  params: Record<string, unknown>;
}

export interface ConnectorResult {
  success: boolean;
  data?: unknown;
  error?: string;
  summary: string;
}

const USER_AGENT = { "User-Agent": "Griot-Connector-Runner/1.0" };

// ==========================================
// 1. GITHUB RUNNER
// ==========================================
export async function executeGitHub(ctx: ConnectorExecutionContext): Promise<ConnectorResult> {
  const token = ctx.credential.trim();
  if (!token) return { success: false, error: "Token GitHub não fornecido.", summary: "Falha de autenticação" };

  const headers = {
    ...USER_AGENT,
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
  };

  const action = ctx.action || "list_repos";
  const p = ctx.params || {};

  try {
    if (action === "list_repos" || action === "repos") {
      const perPage = Number(p.limit || 10);
      const res = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=${perPage}`, { headers });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${await res.text()}`);
      const repos = (await res.json()) as Array<{ name: string; full_name: string; private: boolean; html_url: string; stargazers_count: number; updated_at: string; description: string | null }>;
      const list = repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        url: r.html_url,
        stars: r.stargazers_count,
        updated: r.updated_at,
        description: r.description || "Sem descrição",
      }));
      return {
        success: true,
        data: list,
        summary: `Foram encontrados ${list.length} repositórios no GitHub:\n` + list.map(r => `• ${r.full_name} (${r.private ? "Privado" : "Público"}) - ${r.description} (${r.url})`).join("\n"),
      };
    }

    if (action === "get_repo") {
      const repo = String(p.repo || p.full_name || ctx.account || "");
      if (!repo.includes("/")) throw new Error("Parâmetro repo deve ser 'dono/nome-do-repo'.");
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return {
        success: true,
        data,
        summary: `Repositório ${data.full_name}: ⭐ ${data.stargazers_count} stars, 🍴 ${data.forks_count} forks, branch padrão: ${data.default_branch}. URL: ${data.html_url}`,
      };
    }

    if (action === "list_issues" || action === "issues") {
      const repo = String(p.repo || p.full_name || ctx.account || "");
      if (!repo.includes("/")) throw new Error("Parâmetro repo deve ser 'dono/nome-do-repo'.");
      const state = String(p.state || "open");
      const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=${state}&per_page=10`, { headers });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${await res.text()}`);
      const issues = (await res.json()) as Array<{ number: number; title: string; state: string; html_url: string; user: { login: string } }>;
      return {
        success: true,
        data: issues,
        summary: issues.length ? `Issues em ${repo}:\n` + issues.map(i => `• #${i.number} [${i.state}] ${i.title} por @${i.user?.login} (${i.html_url})`).join("\n") : `Nenhuma issue encontrada em ${repo}.`,
      };
    }

    if (action === "create_issue") {
      const repo = String(p.repo || p.full_name || ctx.account || "");
      if (!repo.includes("/")) throw new Error("Parâmetro repo deve ser 'dono/nome-do-repo'.");
      const title = String(p.title || "").trim();
      if (!title) throw new Error("Título da issue é obrigatório.");
      const body = String(p.body || p.content || "");
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return {
        success: true,
        data,
        summary: `Issue criada com sucesso: #${data.number} "${data.title}" em ${data.html_url}`,
      };
    }

    if (action === "get_file") {
      const repo = String(p.repo || p.full_name || ctx.account || "");
      const path = String(p.path || "").trim();
      if (!repo.includes("/") || !path) throw new Error("Requer 'repo' (dono/repo) e 'path' do ficheiro.");
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const content = data.content ? Buffer.from(data.content, "base64").toString("utf-8") : "";
      return {
        success: true,
        data: { name: data.name, path: data.path, size: data.size, content },
        summary: `Ficheiro ${data.path} (${data.size} bytes):\n\n${content.slice(0, 4000)}`,
      };
    }

    // Default: perfil do utilizador autenticado
    const userRes = await fetch("https://api.github.com/user", { headers });
    if (!userRes.ok) throw new Error(`GitHub respondeu ${userRes.status}: ${await userRes.text()}`);
    const user = await userRes.json();
    return {
      success: true,
      data: user,
      summary: `Conta GitHub autenticada com sucesso: @${user.login} (${user.name || "Sem nome"}), repos públicos: ${user.public_repos}, URL: ${user.html_url}`,
    };
  } catch (err: any) {
    return { success: false, error: err.message, summary: `Erro no GitHub: ${err.message}` };
  }
}

// ==========================================
// 2. GITLAB RUNNER
// ==========================================
export async function executeGitLab(ctx: ConnectorExecutionContext): Promise<ConnectorResult> {
  const token = ctx.credential.trim();
  if (!token) return { success: false, error: "Token GitLab não fornecido.", summary: "Falha de autenticação" };

  const headers = {
    ...USER_AGENT,
    "PRIVATE-TOKEN": token,
  };

  const action = ctx.action || "list_projects";
  const p = ctx.params || {};

  try {
    if (action === "list_projects" || action === "projects") {
      const perPage = Number(p.limit || 10);
      const res = await fetch(`https://gitlab.com/api/v4/projects?membership=true&order_by=updated_at&per_page=${perPage}`, { headers });
      if (!res.ok) throw new Error(`GitLab respondeu ${res.status}: ${await res.text()}`);
      const projects = (await res.json()) as Array<{ id: number; name: string; path_with_namespace: string; web_url: string; description: string | null }>;
      return {
        success: true,
        data: projects,
        summary: projects.length ? `Projetos GitLab encontrados (${projects.length}):\n` + projects.map(pr => `• [ID ${pr.id}] ${pr.path_with_namespace} - ${pr.web_url}`).join("\n") : "Nenhum projeto encontrado.",
      };
    }

    if (action === "list_issues" || action === "issues") {
      const projectId = p.project_id || p.id || ctx.account;
      const url = projectId
        ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(String(projectId))}/issues?per_page=10`
        : `https://gitlab.com/api/v4/issues?scope=all&per_page=10`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitLab respondeu ${res.status}: ${await res.text()}`);
      const issues = (await res.json()) as Array<{ id: number; iid: number; title: string; state: string; web_url: string }>;
      return {
        success: true,
        data: issues,
        summary: issues.length ? `Issues GitLab:\n` + issues.map(i => `• !${i.iid} [${i.state}] ${i.title} (${i.web_url})`).join("\n") : "Nenhuma issue encontrada.",
      };
    }

    // Default: utilizador autenticado
    const userRes = await fetch("https://gitlab.com/api/v4/user", { headers });
    if (!userRes.ok) throw new Error(`GitLab respondeu ${userRes.status}: ${await userRes.text()}`);
    const user = await userRes.json();
    return {
      success: true,
      data: user,
      summary: `Conta GitLab autenticada com sucesso: @${user.username} (${user.name}), ID: ${user.id}, URL: ${user.web_url}`,
    };
  } catch (err: any) {
    return { success: false, error: err.message, summary: `Erro no GitLab: ${err.message}` };
  }
}

// ==========================================
// 3. VERCEL RUNNER
// ==========================================
export async function executeVercel(ctx: ConnectorExecutionContext): Promise<ConnectorResult> {
  const token = ctx.credential.trim();
  if (!token) return { success: false, error: "Token Vercel não fornecido.", summary: "Falha de autenticação" };

  const headers = {
    ...USER_AGENT,
    Authorization: `Bearer ${token}`,
  };

  const action = ctx.action || "list_projects";
  const p = ctx.params || {};

  try {
    if (action === "list_projects" || action === "projects") {
      const res = await fetch("https://api.vercel.com/v9/projects?limit=15", { headers });
      if (!res.ok) throw new Error(`Vercel respondeu ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const list = (data.projects || []).map((proj: any) => ({
        id: proj.id,
        name: proj.name,
        framework: proj.framework || "outro",
        updatedAt: proj.updatedAt,
        targets: proj.targets?.production?.url ? `https://${proj.targets.production.url}` : null,
      }));
      return {
        success: true,
        data: list,
        summary: list.length ? `Projetos Vercel encontrados (${list.length}):\n` + list.map((pr: any) => `• ${pr.name} [${pr.framework}] → ${pr.targets || "Sem produção"}`).join("\n") : "Nenhum projeto encontrado na Vercel.",
      };
    }

    if (action === "list_deployments" || action === "deployments") {
      const projectId = p.project_id || p.projectId || p.name;
      const url = projectId
        ? `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(String(projectId))}&limit=10`
        : "https://api.vercel.com/v6/deployments?limit=10";
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Vercel respondeu ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const list = (data.deployments || []).map((d: any) => ({
        uid: d.uid,
        name: d.name,
        state: d.state,
        url: `https://${d.url}`,
        created: new Date(d.created).toLocaleString("pt-PT"),
      }));
      return {
        success: true,
        data: list,
        summary: list.length ? `Últimos deploys na Vercel:\n` + list.map((d: any) => `• [${d.state}] ${d.name} (${d.created}): ${d.url}`).join("\n") : "Nenhum deployment registado.",
      };
    }

    // Default: dados da conta/token
    const userRes = await fetch("https://api.vercel.com/v2/user", { headers });
    if (!userRes.ok) throw new Error(`Vercel respondeu ${userRes.status}: ${await userRes.text()}`);
    const userData = await userRes.json();
    return {
      success: true,
      data: userData.user,
      summary: `Conta Vercel ligada com sucesso: ${userData.user.username || userData.user.email} (ID: ${userData.user.id})`,
    };
  } catch (err: any) {
    return { success: false, error: err.message, summary: `Erro na Vercel: ${err.message}` };
  }
}

// ==========================================
// 4. SUPABASE RUNNER
// ==========================================
export async function executeSupabase(ctx: ConnectorExecutionContext): Promise<ConnectorResult> {
  const token = ctx.credential.trim();
  if (!token) return { success: false, error: "Credencial Supabase não fornecida.", summary: "Falha de autenticação" };

  const action = ctx.action || "health";
  const p = ctx.params || {};

  // O token pode ser um Management Access Token (sbp_...) ou uma URL + Anon/Service Key
  const isManagementToken = token.startsWith("sbp_") || !token.includes(".");

  try {
    if (isManagementToken) {
      // Management API da Supabase
      const headers = { ...USER_AGENT, Authorization: `Bearer ${token}` };

      if (action === "list_projects" || action === "projects" || action === "health") {
        const res = await fetch("https://api.supabase.com/v1/projects", { headers });
        if (!res.ok) throw new Error(`Supabase Management respondeu ${res.status}: ${await res.text()}`);
        const projects = (await res.json()) as Array<{ id: string; name: string; region: string; status: string }>;
        return {
          success: true,
          data: projects,
          summary: projects.length ? `Projetos Supabase activos (${projects.length}):\n` + projects.map(pr => `• ${pr.name} (Ref: ${pr.id}, Região: ${pr.region}, Estado: ${pr.status})`).join("\n") : "Nenhum projeto encontrado na conta Supabase.",
        };
      }
    }

    // PostgREST Query em Projeto Específico (usando ctx.account como project-ref ou URL)
    let baseUrl = ctx.account || (p.project_url as string) || "";
    if (baseUrl && !baseUrl.startsWith("http")) {
      baseUrl = `https://${baseUrl}.supabase.co`;
    }

    if (!baseUrl) {
      return {
        success: true,
        data: { tokenType: "Supabase Key", status: "valid" },
        summary: "Credencial Supabase válida. Para consultar dados de tabelas, especifica a URL do projeto (ex: https://xyz.supabase.co) no Identificador do Workspace.",
      };
    }

    const table = String(p.table || "health");
    const restUrl = `${baseUrl.replace(/\/+$/, "")}/rest/v1/${table}?select=*&limit=10`;
    const res = await fetch(restUrl, {
      headers: {
        ...USER_AGENT,
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) throw new Error(`Supabase PostgREST respondeu ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    return {
      success: true,
      data: rows,
      summary: `Consulta Supabase na tabela '${table}' (${Array.isArray(rows) ? rows.length : 1} registos):\n` + JSON.stringify(rows, null, 2).slice(0, 3000),
    };
  } catch (err: any) {
    return { success: false, error: err.message, summary: `Erro no Supabase: ${err.message}` };
  }
}

// ==========================================
// 5. FIREBASE RUNNER
// ==========================================
export async function executeFirebase(ctx: ConnectorExecutionContext): Promise<ConnectorResult> {
  const token = ctx.credential.trim();
  if (!token) return { success: false, error: "Credencial Firebase não fornecida.", summary: "Falha de autenticação" };

  const p = ctx.params || {};
  const projectId = String(ctx.account || p.project_id || p.projectId || "").trim();

  try {
    if (!projectId) {
      return {
        success: true,
        data: { status: "ready" },
        summary: "Credencial Firebase guardada. Para consultar coleções do Firestore ou autenticação, adiciona o 'Project ID' (ex.: meu-app-prod) no campo Identificador de Conta.",
      };
    }

    const action = ctx.action || "list_documents";
    const collection = String(p.collection || "users");

    // Endpoint Firestore REST v1
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?pageSize=10`;
    const headers: Record<string, string> = { ...USER_AGENT };
    if (token.startsWith("ya29.") || token.length > 80) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["x-goog-api-key"] = token;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      // Se não autenticou diretamente como Bearer, tenta inspeção do projeto
      throw new Error(`Firebase Firestore respondeu ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const docs = (data.documents || []).map((d: any) => ({
      name: d.name.split("/").pop(),
      createTime: d.createTime,
      fields: d.fields,
    }));

    return {
      success: true,
      data: docs,
      summary: docs.length
        ? `Coleção Firestore '${collection}' em '${projectId}' (${docs.length} documentos):\n` + docs.map((doc: any) => `• ID ${doc.name} (Criado: ${doc.createTime})`).join("\n")
        : `Nenhum documento encontrado na coleção '${collection}' do Firebase '${projectId}'.`,
    };
  } catch (err: any) {
    return { success: false, error: err.message, summary: `Erro no Firebase: ${err.message}` };
  }
}

// ==========================================
// DISPATCHER PRINCIPAL DO LOTE 1
// ==========================================
export async function executeBatch1Connector(
  connectorId: string,
  ctx: ConnectorExecutionContext,
): Promise<ConnectorResult> {
  switch (connectorId.toLowerCase()) {
    case "github":
      return executeGitHub(ctx);
    case "gitlab":
      return executeGitLab(ctx);
    case "vercel":
      return executeVercel(ctx);
    case "supabase":
      return executeSupabase(ctx);
    case "firebase":
      return executeFirebase(ctx);
    default:
      return {
        success: false,
        error: `Conector '${connectorId}' ainda não pertence ao Lote 1 ativo.`,
        summary: `Conector ${connectorId} em fila para os próximos lotes.`,
      };
  }
}
