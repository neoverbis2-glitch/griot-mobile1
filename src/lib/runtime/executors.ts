/**
 * GRIOT Action Executor.
 *
 * The Mobile client is deliberately not a fake shell: execution is delegated to
 * the authenticated GRIOT runtime endpoint. A missing runtime is reported as a
 * real failure instead of returning fabricated git/npm/test output.
 */

import { executeRemoteAction } from "./remote-executor";
import { executeLocalAction } from "./local-harness";
import { executeInGriotSandbox } from "./sandbox-executor";
import type { GriotAction, GriotExecutionResult } from "./protocol";
import { getPrimaryWorkspaceId } from "@/lib/griot-api";
import { supabase } from "@/integrations/supabase/client";
import { executeUniversalConnector, normalizeConnectorId } from "@/lib/connectors-hub";
import { getConnectedPlugins, isPluginConnected, resolveActivePluginCredentials } from "@/lib/plugins-service";

export class GriotActionExecutor {
  async execute(action: GriotAction): Promise<GriotExecutionResult> {
    // 0. Conectores e Plugins externos (Matriz Universal dos 30 Conectores)
    if (action.category === "connector" || action.type === "connector.execute") {
      const startMs = Date.now();
      const connectorName = String(
        action.params.connector || action.params.plugin || action.params.name || "",
      )
        .toLowerCase()
        .trim();
      const normConnector = normalizeConnectorId(connectorName);
      const actionName = String(action.params.action || "default");
      const connectorParams = (action.params.params || action.params) as Record<string, unknown>;

      // Recupera credenciais ativas do plugin
      const resolvedCreds = resolveActivePluginCredentials(normConnector);

      const credential = String(
        action.params.credential ||
          action.params.token ||
          action.params.apiKey ||
          resolvedCreds.apiKey ||
          "",
      ).trim();

      const account = String(
        action.params.account ||
          action.params.accountName ||
          action.params.ref ||
          resolvedCreds.accountName ||
          resolvedCreds.projectRef ||
          "",
      ).trim();

      const customEndpoint = String(
        action.params.customEndpoint ||
          action.params.endpoint ||
          resolvedCreds.customEndpoint ||
          "",
      ).trim();

      const projectRef = String(
        action.params.ref ||
          action.params.projectRef ||
          action.params.project_id ||
          resolvedCreds.projectRef ||
          account ||
          "",
      ).trim();

      if (!isPluginConnected(normConnector) && !credential) {
        return {
          actionId: action.id,
          actionType: action.type,
          status: "failed",
          exitCode: 1,
          stdout: "",
          stderr: `⚠️ O conector "${connectorName.toUpperCase()}" não está configurado no GRIOT. Por favor, acede a Definições → Plugins e adiciona o teu token/chave para ${connectorName}.`,
          durationMs: Date.now() - startMs,
        };
      }

      const res = await executeUniversalConnector(normConnector, {
        credential,
        account: account || projectRef || undefined,
        action: actionName,
        params: {
          ...connectorParams,
          ...(projectRef ? { ref: projectRef, projectRef, project_id: projectRef } : {}),
          ...(customEndpoint ? { customEndpoint } : {}),
        },
      });

      return {
        actionId: action.id,
        actionType: action.type,
        status: res.success ? "success" : "failed",
        exitCode: res.success ? 0 : 1,
        stdout: res.summary || (res.data ? JSON.stringify(res.data, null, 2) : "Ação concluída."),
        stderr: res.error || "",
        durationMs: Date.now() - startMs,
      };
    }

    let workspaceId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) workspaceId = await getPrimaryWorkspaceId(data.user.id);
    } catch {
      // Falhas de autenticação são tratadas localmente
    }

    const effectiveWsId = workspaceId || "local-default";

    // 1. Operações de sistema de ficheiros (fs.*), pesquisa (search.*) ou projetos (project.*) são geridas no workspace local
    if (
      action.category === "fs" ||
      action.category === "search" ||
      action.category === "project" ||
      action.type.startsWith("project.")
    ) {
      return executeLocalAction(action, effectiveWsId);
    }

    // 2. Comandos de Terminal / Shell / Git / Testes:
    // Tenta primeiro no GRIOT Sandbox isolado (se estiver provisionado e online).
    // Se não houver container isolado configurado ou ocorrer indisponibilidade de infraestrutura,
    // executa no Harness Local do workspace para garantir funcionamento resiliente com auto-recuperação.
    try {
      const sandboxRes = await executeInGriotSandbox(action);
      const isInfraError =
        sandboxRes.stderr.includes("Nenhum projeto ativo") ||
        sandboxRes.stderr.includes("Runtime isolado indisponível") ||
        sandboxRes.stderr.includes("Falha ao provisionar container") ||
        sandboxRes.stderr.includes("FunctionsFetchError") ||
        sandboxRes.stderr.includes("Execution Gateway") ||
        sandboxRes.stderr.includes("Studio Compute");

      if (sandboxRes.status === "success" || (sandboxRes.status === "failed" && !isInfraError)) {
        return sandboxRes;
      }
    } catch {
      // Falha de rede ou sandbox não provisionado, segue para o harness local
    }

    return executeLocalAction(action, effectiveWsId);
  }

  formatFeedbackForAI(result: GriotExecutionResult): string {
    return [
      "[GRIOT Action Execution Result]",
      `Action: ${result.actionType}`,
      `Status: ${result.status.toUpperCase()} (Exit Code: ${result.exitCode})`,
      `Duration: ${result.durationMs}ms`,
      result.stdout ? `--- STDOUT ---\n${result.stdout}` : "",
      result.stderr ? `--- STDERR ---\n${result.stderr}` : "",
      "[End of Execution Result]",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

export const defaultExecutor = new GriotActionExecutor();
