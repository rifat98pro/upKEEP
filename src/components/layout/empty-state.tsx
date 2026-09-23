import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** Empty states say what is missing and what to do about it (§33). */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg border bg-card">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
