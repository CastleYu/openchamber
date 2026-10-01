import { toast } from '@/components/ui';
import type { I18nKey, I18nParams } from '@/lib/i18n';
import { applyPendingOpenCodeRestart } from '@/lib/opencode/deferredRestart';

type TranslateFn = (key: I18nKey, params?: I18nParams) => string;

export async function restartOpenCodeWithFeedback(t: TranslateFn): Promise<void> {
  try {
    const result = await applyPendingOpenCodeRestart({
      message: t('settings.openchamber.opencodeCli.actions.restartingOpenCode'),
    });
    if (result.requiresManualRestart) toast.warning(t('settings.openchamber.opencodeCli.restart.external'));
  } catch {
    toast.error(t('settings.openchamber.opencodeCli.restart.restartFailed'));
  }
}
