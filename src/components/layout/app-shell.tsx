'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  LayoutGrid,
  ListChecks,
  Menu,
  Moon,
  Receipt,
  Settings,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConnectButton } from '@/components/wallet/connect-button';
import { NetworkStatusPanel } from '@/components/layout/network-status';
import { UpkeepMark } from '@/components/layout/logo';
import { NetworkBanner } from '@/components/layout/banners';
import { cn } from '@/lib/utils';
import { isRehearsalNetwork, networkName } from '@/config/env';
import { isDemoMode } from '@/config/contracts';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
  { href: '/conditions', label: 'Conditions', icon: ListChecks },
  { href: '/executions', label: 'Executions', icon: Receipt },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/docs', label: 'Docs', icon: BookOpen },
] as const;

/** Bottom navigation on mobile keeps the primary destinations reachable. */
const MOBILE_NAV = NAV_ITEMS.slice(0, 4);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the drawer on navigation, or it stays open over the new page.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      {/*
        The sidebar sits on the page colour rather than the card colour.
        The logo ships with its own navy baked in, so any surface behind it that
        differs leaves a visible tile around the mark. --background is sampled
        from the artwork's corners; --card is four points lighter and framed it.
      */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-background lg:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-in slide-in-from-left flex-col border-r bg-background">
            <SidebarContent pathname={pathname} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden />
          </Button>

          <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
            <UpkeepMark className="size-6" />
            <span className="font-semibold tracking-tight">upKEEP</span>
          </Link>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {isDemoMode ? (
              <Badge variant="warning" className="hidden sm:inline-flex">
                Demo mode
              </Badge>
            ) : null}
            <Badge
              variant={isRehearsalNetwork ? 'warning' : 'outline'}
              className="hidden gap-1.5 md:inline-flex"
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  isRehearsalNetwork ? 'bg-warning' : 'bg-success',
                )}
              />
              {networkName}
            </Badge>
            <ConnectButton />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:pb-10">
          <div className="mx-auto w-full max-w-6xl">
            <NetworkBanner />
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-card/95 backdrop-blur-md lg:hidden">
        {MOBILE_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-2xs transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <item.icon className={cn('size-5', active && 'text-brand')} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <UpkeepMark className="size-6" />
          <span className="font-semibold tracking-tight">upKEEP</span>
        </Link>
        {onClose ? (
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </Button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              <item.icon className={cn('size-4', active && 'text-brand')} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t">
        <NetworkStatusPanel />
      </div>
    </>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // Theme is unknown until hydration; render a stable placeholder until then.
  React.useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {mounted && resolvedTheme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
