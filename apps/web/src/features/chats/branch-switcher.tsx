import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import type { Branch } from './message-tree';

/** "‹ 2/3 ›": the versions of a message that share a parent (regenerated answers, edited questions). */
export function BranchSwitcher({
  branch,
  disabled,
  onSwitch,
}: {
  branch: Branch;
  disabled: boolean;
  onSwitch: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  if (branch.count < 2) return null;
  return (
    <div
      role="group"
      aria-label={t('chats.branch.label')}
      className="text-muted-foreground flex items-center text-xs"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('chats.branch.previous')}
        disabled={disabled || branch.previousId === null}
        onClick={() => {
          if (branch.previousId !== null) onSwitch(branch.previousId);
        }}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span
        aria-label={t('chats.branch.position', { index: branch.index + 1, count: branch.count })}
      >
        {branch.index + 1}/{branch.count}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('chats.branch.next')}
        disabled={disabled || branch.nextId === null}
        onClick={() => {
          if (branch.nextId !== null) onSwitch(branch.nextId);
        }}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
