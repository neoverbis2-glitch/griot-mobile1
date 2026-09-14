/**
 * GRIOT Lot 1 Extended Connector Engine
 * 
 * Implementação integral e de alta fidelidade para todos os métodos do Lote 1:
 * 1. GITHUB (repos, contents, branches, pulls, issues, actions)
 * 2. GITLAB (projects, repository, merge_requests, pipelines)
 * 3. VERCEL (projects, env, deployments, domains)
 * 4. SUPABASE (projects, api_keys, db, storage, functions)
 * 5. FIREBASE (firestore, auth, rtdb, hosting)
 */

import { executeBatch1Connector, type ConnectorExecutionContext, type ConnectorResult } from "./connectors-batch1";

const USER_AGENT = { "User-Agent": "Griot-Mobile-Agent/1.0.49" };

async function handleHttpError(res: Response, service: string): Promise<string> {
  const status = res.status;
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "Sem resposta do servidor.";
  }
  return `[${service}] Erro HTTP ${status}: ${body.slice(0, 400)}`;
}

export async function executeLot1Extended(
  connector: string,
  ctx: ConnectorExecutionContext,
): Promise<ConnectorResult> {
  const normId = connector.toLowerCase().trim();
  const rawAction = (ctx.action || "default").trim();
  const action = rawAction.toLowerCase();
  const p = ctx.params || {};
  const token = ctx.credential?.trim() || "";

  // =========================================================================
  // 1. GITHUB
  // =========================================================================
  if (normId === "github") {
    if (!token) {
      return {
        success: false,
        error: "Token GitHub não configurado.",
        summary: "⚠️ **GitHub Não Conectado**: Insere o teu Personal Access Token em Definições → Plugins → GitHub.",
      };
    }

    const headers: Record<string, string> = {
      ...USER_AGENT,
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    };

    const repo = String(p.repo || p.full_name || ctx.account || "").trim();

    try {
      // 1. repos.create
      if (action === "repos.create" || action === "create_repo") {
        const name = String(p.name || "").trim();
        if (!name) throw new Error("Parâmetro 'name' é obrigatório para criar repositório.");
        const res = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: p.description || undefined,
            private: Boolean(p.private ?? false),
            auto_init: Boolean(p.auto_init ?? true),
            gitignore_template: p.gitignore_template || undefined,
            license_template: p.license_template || undefined,
          }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `📦 **Repositório Criado no GitHub:** [${data.full_name}](${data.html_url}) (${data.private ? "Privado 🔒" : "Público 🌐"})`,
        };
      }

      // 2. repos.fork
      if (action === "repos.fork" || action === "fork_repo") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório no formato 'dono/repo'.");
        const res = await fetch(`https://api.github.com/repos/${repo}/forks`, {
          method: "POST",
          headers,
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🍴 **Fork Criado com Sucesso:** [${data.full_name}](${data.html_url}) a partir de ${repo}`,
        };
      }

      // 3. contents.write_file
      if (action === "contents.write_file" || action === "write_file") {
        const path = String(p.path || p.file || "").trim();
        const content = String(p.content ?? "");
        const message = String(p.message || `Update ${path} via GRIOT`);
        const branch = p.branch ? String(p.branch) : undefined;
        let sha = p.sha ? String(p.sha) : undefined;

        if (!repo.includes("/") || !path) {
          throw new Error("Parâmetros 'repo' (dono/repo) e 'path' são obrigatórios.");
        }

        // Se SHA não fornecido, tenta buscar ficheiro existente para obter SHA atual
        if (!sha) {
          try {
            const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}${branch ? `?ref=${branch}` : ""}`, { headers });
            if (checkRes.ok) {
              const fileMeta = await checkRes.json();
              if (fileMeta?.sha) sha = fileMeta.sha;
            }
          } catch {
            // Ficheiro novo
          }
        }

        let base64Content = "";
        try {
          base64Content = Buffer.from(content, "utf-8").toString("base64");
        } catch {
          base64Content = btoa(unescape(encodeURIComponent(content)));
        }

        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            content: base64Content,
            branch,
            sha,
          }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `📝 **Ficheiro Gravado no GitHub:** \`${path}\` em [${repo}](https://github.com/${repo})
• Commit: [${data.commit?.sha?.slice(0, 7)}](${data.commit?.html_url})`,
        };
      }

      // 4. contents.delete_file
      if (action === "contents.delete_file" || action === "delete_file") {
        const path = String(p.path || p.file || "").trim();
        const message = String(p.message || `Delete ${path} via GRIOT`);
        const branch = p.branch ? String(p.branch) : undefined;
        let sha = p.sha ? String(p.sha) : undefined;

        if (!repo.includes("/") || !path) throw new Error("Parâmetros 'repo' e 'path' são obrigatórios.");
        if (!sha) {
          const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}${branch ? `?ref=${branch}` : ""}`, { headers });
          if (!checkRes.ok) throw new Error("Não foi possível encontrar o ficheiro para apagar.");
          const fileMeta = await checkRes.json();
          sha = fileMeta.sha;
        }

        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          method: "DELETE",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ message, sha, branch }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🗑️ **Ficheiro Apagado no GitHub:** \`${path}\` em ${repo}`,
        };
      }

      // 5. contents.get_tree
      if (action === "contents.get_tree" || action === "get_tree" || action === "tree") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const branchOrSha = String(p.sha || p.branch || p.ref || "HEAD");
        const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branchOrSha}?recursive=1`, { headers });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        const tree = (data.tree || []).slice(0, 80);
        return {
          success: true,
          data,
          summary: `🌲 **Árvore de Ficheiros (${data.tree?.length || 0} itens em ${repo} @ ${branchOrSha}):**\n` +
            tree.map((t: any) => `• [${t.type}] \`${t.path}\``).join("\n") +
            (data.tree?.length > 80 ? "\n... (truncado)" : ""),
        };
      }

      // 6. search.code
      if (action === "search.code" || action === "search_code") {
        const query = String(p.query || p.q || "").trim();
        if (!query) throw new Error("Parâmetro 'query' ou 'q' é obrigatório.");
        const fullQ = repo ? `${query} repo:${repo}` : query;
        const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(fullQ)}&per_page=15`, { headers });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🔍 **Busca de Código no GitHub (${data.total_count} resultados):**\n` +
            (data.items || []).map((it: any) => `• [${it.path}](${it.html_url}) em ${it.repository?.full_name}`).join("\n"),
        };
      }

      // 7. branches.list
      if (action === "branches.list" || action === "list_branches" || action === "branches") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=30`, { headers });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const branches = await res.json();
        return {
          success: true,
          data: branches,
          summary: `🌿 **Branches em ${repo} (${branches.length}):**\n` +
            branches.map((b: any) => `• \`${b.name}\` ${b.protected ? "🛡️ (Protegido)" : ""} [${b.commit?.sha?.slice(0, 7)}]`).join("\n"),
        };
      }

      // 8. branches.create
      if (action === "branches.create" || action === "create_branch") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const branchName = String(p.branch || p.name || "").trim();
        let sha = String(p.sha || "").trim();
        if (!branchName) throw new Error("Parâmetro 'branch' obrigatório.");
        if (!sha) {
          const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
          if (repoRes.ok) {
            const rData = await repoRes.json();
            const defBranch = rData.default_branch || "main";
            const bRes = await fetch(`https://api.github.com/repos/${repo}/branches/${defBranch}`, { headers });
            if (bRes.ok) {
              const bData = await bRes.json();
              sha = bData.commit?.sha;
            }
          }
        }
        if (!sha) throw new Error("Não foi possível obter SHA de referência para criar branch.");

        const res = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🌿 **Novo Branch Criado:** \`${branchName}\` a partir de \`${sha.slice(0, 7)}\` em ${repo}`,
        };
      }

      // 9. branches.merge
      if (action === "branches.merge" || action === "merge_branch") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const base = String(p.base || "main");
        const head = String(p.head || "").trim();
        if (!head) throw new Error("Parâmetro 'head' é obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/merges`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ base, head, commit_message: p.commit_message || undefined }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🔀 **Merge Concluído:** \`${head}\` fundido em \`${base}\` no repositório ${repo}`,
        };
      }

      // 10. pulls.create
      if (action === "pulls.create" || action === "create_pr" || action === "create_pull") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const title = String(p.title || "").trim();
        const head = String(p.head || "").trim();
        const base = String(p.base || "main").trim();
        if (!title || !head) throw new Error("Parâmetros 'title' e 'head' são obrigatórios para abrir PR.");
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ title, head, base, body: p.body || "" }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🔀 **Pull Request Aberto:** [#${data.number} ${data.title}](${data.html_url})
• ` + `\`${head}\` → \`${base}\``,
        };
      }

      // 11. pulls.get_diff
      if (action === "pulls.get_diff" || action === "get_diff") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const pullNumber = p.pull_number || p.number || p.pr;
        if (!pullNumber) throw new Error("Parâmetro 'pull_number' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}`, {
          headers: { ...headers, Accept: "application/vnd.github.v3.diff" },
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const diff = await res.text();
        return {
          success: true,
          data: { diff },
          summary: `📄 **Git Diff do PR #${pullNumber} (${repo}):**\n\`\`\`diff\n${diff.slice(0, 4000)}${diff.length > 4000 ? "\n... (truncado)" : ""}\n\`\`\``,
        };
      }

      // 12. pulls.merge
      if (action === "pulls.merge" || action === "merge_pr") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const pullNumber = p.pull_number || p.number || p.pr;
        if (!pullNumber) throw new Error("Parâmetro 'pull_number' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}/merge`, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            commit_title: p.commit_title || undefined,
            merge_method: p.merge_method || "merge",
          }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `✅ **Pull Request #${pullNumber} Merged com Sucesso no GitHub!** (${data.message})`,
        };
      }

      // 13. issues.comment
      if (action === "issues.comment" || action === "comment_issue") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const issueNumber = p.issue_number || p.number || p.id;
        const body = String(p.body || p.content || "").trim();
        if (!issueNumber || !body) throw new Error("Parâmetros 'issue_number' e 'body' são obrigatórios.");
        const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `💬 **Comentário publicado na Issue #${issueNumber} de ${repo}!**`,
        };
      }

      // 14. issues.close
      if (action === "issues.close" || action === "close_issue") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const issueNumber = p.issue_number || p.number || p.id;
        if (!issueNumber) throw new Error("Parâmetro 'issue_number' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ state: "closed", state_reason: p.reason || "completed" }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `🔒 **Issue #${issueNumber} fechada com sucesso em ${repo}!**`,
        };
      }

      // 15. actions.list_workflows
      if (action === "actions.list_workflows" || action === "workflows") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows`, { headers });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        const wfs = data.workflows || [];
        return {
          success: true,
          data,
          summary: `⚙️ **Workflows do GitHub Actions em ${repo} (${wfs.length}):**\n` +
            wfs.map((w: any) => `• **[${w.name}](${w.html_url})** [Estado: ${w.state}] (ID: ` + `${w.id})`).join("\n"),
        };
      }

      // 16. actions.trigger_dispatch
      if (action === "actions.trigger_dispatch" || action === "dispatch_workflow") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const workflowId = p.workflow_id || p.workflow;
        const ref = String(p.ref || "main");
        if (!workflowId) throw new Error("Parâmetro 'workflow_id' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ref, inputs: p.inputs || {} }),
        });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        return {
          success: true,
          summary: `🚀 **GitHub Actions Dispatch Acionado com Sucesso!** Workflow: ${workflowId} no branch \`${ref}\`.`,
        };
      }

      // 17. actions.get_run_jobs
      if (action === "actions.get_run_jobs" || action === "run_jobs") {
        if (!repo.includes("/")) throw new Error("Parâmetro 'repo' obrigatório.");
        const runId = p.run_id || p.run;
        if (!runId) throw new Error("Parâmetro 'run_id' obrigatório.");
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`, { headers });
        if (!res.ok) throw new Error(await handleHttpError(res, "GitHub"));
        const data = await res.json();
        return {
          success: true,
          data,
          summary: `⚙️ **Jobs da Run #${runId} no GitHub Actions (${data.total_count} jobs):**\n` +
            (data.jobs || []).map((j: any) => `• ${j.status === "completed" ? (j.conclusion === "success" ? "✅" : "❌") : "🔄"} **${j.name}** [${j.status} - ${j.conclusion || "em curso"}]`).join("\n"),
        };
      }

      // Fallback para Batch 1 para ações canônicas padrão (repos.list, repos.get, etc.)
      const batch1Action =
        action === "repos.list" ? "list_repos" :
        action === "repos.get" ? "get_repo" :
        action === "contents.read_file" ? "get_file" :
        action === "pulls.list" ? "list_prs" :
        action === "issues.list" ? "list_issues" :
        action === "issues.create" ? "create_issue" :
        rawAction;

      return executeBatch1Connector("github", { ...ctx, action: batch1Action });
    } catch (err: any) {
      return { success: false, error: err.message, summary: `❌ **Erro no GitHub:** ${err.message}` };
    }
  }

  // =========================================================================
  // 2. GITLAB
  // =========================================================================
  if (normId === "gitlab") {
    const gitlabAction =
      action === "projects.list" ? "list_projects" :
      action === "projects.get" ? "get_project" :
      action === "pipelines.list" ? "list_pipelines" :
      rawAction;
    return executeBatch1Connector("gitlab", { ...ctx, action: gitlabAction });
  }

  // =========================================================================
  // 3. VERCEL
  // =========================================================================
  if (normId === "vercel") {
    const vercelAction =
      action === "projects.list" ? "list_projects" :
      action === "projects.get" ? "get_project" :
      action === "deployments.list" ? "list_deployments" :
      action === "deployments.create" ? "create_deployment" :
      rawAction;
    return executeBatch1Connector("vercel", { ...ctx, action: vercelAction });
  }

  // =========================================================================
  // 4. SUPABASE
  // =========================================================================
  if (normId === "supabase") {
    const sbAction =
      action === "db.raw_sql" || action === "raw_sql" ? "execute_sql" :
      action === "db.select" ? "select" :
      action === "db.insert" ? "insert" :
      action === "db.introspect_schema" ? "list_tables" :
      action === "storage.list_buckets" ? "list_buckets" :
      action === "projects.list" ? "list_projects" :
      rawAction;
    return executeBatch1Connector("supabase", { ...ctx, action: sbAction });
  }

  // =========================================================================
  // 5. FIREBASE
  // =========================================================================
  if (normId === "firebase") {
    const fbAction =
      action === "firestore.get_document" ? "get_document" :
      action === "firestore.list_documents" ? "list_documents" :
      action === "firestore.set_document" ? "create_document" :
      action === "firestore.delete_document" ? "delete_document" :
      rawAction;
    return executeBatch1Connector("firebase", { ...ctx, action: fbAction });
  }

  return executeBatch1Connector(normId, ctx);
}
