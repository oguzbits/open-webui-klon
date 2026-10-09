import { PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

import { errorMessageKey } from '@/api/error-message';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import { useCurrentUser } from '@/features/auth/session';
import { useSignOut } from '@/features/auth/use-sign-out';

// The generated SidebarTrigger has an English hidden label; this one is translated.
function SidebarToggle() {
  const { t } = useTranslation();
  const { toggleSidebar } = useSidebar();
  return (
    <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label={t('nav.toggle')}>
      <PanelLeft aria-hidden />
    </Button>
  );
}

function UserFooter() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const signOut = useSignOut();
  return (
    <SidebarFooter className="gap-2">
      <p className="truncate px-2 text-sm" title={user.email}>
        {user.name}
      </p>
      {signOut.isError && (
        <p role="alert" className="text-destructive px-2 text-xs">
          {t(errorMessageKey(signOut.error))}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={signOut.isPending}
        onClick={() => {
          signOut.mutate();
        }}
      >
        {signOut.isPending ? t('userMenu.signingOut') : t('userMenu.signOut')}
      </Button>
    </SidebarFooter>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  return (
    <SidebarProvider>
      <a
        href="#content"
        className="bg-background sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar>
        <SidebarHeader>
          <span className="px-2 font-semibold">{t('app.name')}</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/" end>
                      {t('nav.home')}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/settings/account">{t('nav.account')}</NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <UserFooter />
      </Sidebar>
      {/* SidebarInset renders the main landmark. */}
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarToggle />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <div id="content" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
