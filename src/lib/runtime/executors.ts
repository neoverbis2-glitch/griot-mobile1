/**
 * GRIOT Action Executor.
 *
 * The Mobile client is deliberately not a fake shell: execution is delegated to
 * the authenticated GRIOT runtime endpoint. A missing runtime is reported as a
 * real failure instead of returning fabricated git/npm/test output.
 */

import { executeRemoteAction } from './remote-executor';
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
      // Authentication failures are handled by the runtime gateway.
    }

    return executeRemoteAction(action, {
      workspaceId,
      endpoint: import.meta.env.VITE_GRIOT_RUNTIME_EXECUTOR_URL || '/api/runtime/execute',
    });
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
