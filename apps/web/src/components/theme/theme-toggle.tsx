import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { THEME, type Theme, useTheme } from './theme-provider';

const NEXT: Record<Theme, Theme> = {
  [THEME.SYSTEM]: THEME.LIGHT,
  [THEME.LIGHT]: THEME.DARK,
  [THEME.DARK]: THEME.SYSTEM,
};

const ICON = { [THEME.SYSTEM]: Monitor, [THEME.LIGHT]: Sun, [THEME.DARK]: Moon };

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        setTheme(NEXT[theme]);
      }}
      aria-label={t('theme.toggle', { current: t(`theme.${theme}`) })}
    >
      <Icon aria-hidden />
    </Button>
  );
}
