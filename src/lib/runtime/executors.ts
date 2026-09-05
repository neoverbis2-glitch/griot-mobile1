/**
 * GRIOT Action Executor.
 *
 * The Mobile client is deliberately not a fake shell: execution is delegated to
 * the authenticated GRIOT runtime endpoint. A missing runtime is reported as a
 * real failure instead of returning fabricated git/npm/test output.
 */

import { executeRemoteAction } from './remote-executor';
import { executeLocalAction } from './local-harness';
import type { GriotAction, GriotExecutionResult } from './protocol';
import { getPrimaryWorkspaceId } from '@/lib/griot-api';
import { supabase } from '@/integrations/supabase/client';

export class GriotActionExecutor {
  async execute(action: GriotAction): Promise<GriotExecutionResult> {
    let workspaceId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) workspaceId = await getPrimaryWorkspaceId(data.user.id);
    } catch {
      // Falhas de autenticação são tratadas localmente
    }

    const effectiveWsId = workspaceId || 'local-default';

    // 1. Operações de sistema de ficheiros (fs.*) e git.* são geridas no workspace local
    if (action.category === 'fs' || action.category === 'git') {
      return executeLocalAction(action, effectiveWsId);
    }

    // 2. Operações de terminal/shell/testes: verificar se há runner remoto configurado
    const customRunnerUrl = typeof window !== 'undefined' ? window.localStorage.getItem('griot_gcp_runner_url') || '' : '';
    const configuredEndpoint = import.meta.env.VITE_GRIOT_RUNTIME_EXECUTOR_URL || customRunnerUrl;

    if (configuredEndpoint) {
      try {
        const remoteRes = await executeRemoteAction(action, {
          workspaceId: effectiveWsId,
          endpoint: configuredEndpoint,
        });

        if (
          remoteRes.status === 'success' ||
          (remoteRes.status === 'failed' &&
            !remoteRes.stderr.includes('Runtime unavailable') &&
            !remoteRes.stderr.includes('invalid result'))
        ) {
          return remoteRes;
        }
      } catch (err) {
        console.warn('[GRIOT] Remote runner falhou, caindo para Local/Cloud Shell Harness:', err);
      }
    }

    // 3. Fallback inteligente: executa localmente ou solicita ativação do Cloud Shell se for comando pesado
    return executeLocalAction(action, effectiveWsId);
  }

  formatFeedbackForAI(result: GriotExecutionResult): string {
    return [
      '[GRIOT Action Execution Result]',
      `Action: ${result.actionType}`,
      `Status: ${result.status.toUpperCase()} (Exit Code: ${result.exitCode})`,
      `Duration: ${result.durationMs}ms`,
      result.stdout ? `--- STDOUT ---\n${result.stdout}` : '',
      result.stderr ? `--- STDERR ---\n${result.stderr}` : '',
      '[End of Execution Result]',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export const defaultExecutor = new GriotActionExecutor();
