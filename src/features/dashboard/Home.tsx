import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  Car,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Gavel,
  Inbox,
  KeyRound,
  Moon,
  Search,
  Settings,
  SignpostBig,
  Truck,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { Button } from '@/components/ui/primitives';
import { UserMenu } from '@/components/layout/UserMenu';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { BoardPanel } from '@/features/board/Board';
import { cn } from '@/lib/cn';
import type { SectionKey, Tab as HubTab } from '@/features/setup/AgencySetup';
import type { MasterTab } from '@/features/index/IndexPages';

/**
 * Where the app goes when something on this page is pressed.
 *
 * It lives here rather than in the app shell because this page is the only
 * thing that produces one. The shell's job is to render whichever screen the
 * union names; deciding which screens exist to be reached is the home page's.
 */
export type Destination =
  | { kind: 'hub'; section: SectionKey; start?: HubTab }
  | { kind: 'master'; start?: MasterTab }
  | { kind: 'board' }
  | { kind: 'briefing' }
  | { kind: 'cases' };

/**
 * The home page.
 *
 * It used to be the case list with the board and eleven destinations stacked
 * on top. That is the shape every records system drifts into — everything is
 * important, so everything is on the front — and the result is a page where
 * nothing stands out and the officer scrolls past the BOLO to reach their
 * drafts.
 *
 * So it holds one thing to read and a small number of ways in. The board is
 * the thing to read, because it is what the shift needs to know and the person
 * looking at it is about to walk out of a door. Everything else is a button.
 *
 * The row of buttons is deliberately short. The things an officer reaches for
 * every shift are named on the page; the rest — the property room, the fleet,
 * the stop log, the activity report — live behind Tools, which is the same
 * arrangement as a File menu and for the same reason: they are used
 * occasionally by everybody and constantly by nobody.
 */
export function Home({
  onGo,
  onOpenSearch,
}: {
  onGo: (to: Destination) => void;
  onOpenSearch: () => void;
}) {
  const { agency, can, startCrash, startArrest, createNew } = useStore();

  const mayReview = can('reports.approve');
  const mayConfigureAgency =
    can('agency.configure') || can('users.manage') || can('audit.view') || can('records.seal');
  /*
    Public records is a records and administrative job. A patrol officer has no
    reason to open the request queue, and a row of buttons that includes things
    somebody will never press is a row that takes longer to read. Logging a
    request is still open to everybody from inside the queue, which is the rule
    that matters: a walk-in request nobody logged because the clerk was at
    lunch is a statutory clock that never started.
  */
  const mayHandlePublicRecords = can('records.release') || can('records.seal');

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="mr-2 min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-ink">Aegis RMS</p>
          <p className="truncate text-[11.5px] text-muted">{agency.name || 'Records'}</p>
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          title="Search people, vehicles, places, reports and crashes"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-muted transition hover:border-accent/40 hover:text-ink"
        >
          <Search size={15} className="text-faint" aria-hidden />
          Look up anything
          <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
            ⌘K
          </kbd>
        </button>

        <div className="flex-1" />

        <UserMenu />

        {/*
          A gear that means what a gear means: this account. How I sign in,
          what I have raised.
        */}
        <button
          type="button"
          onClick={() => onGo({ kind: 'hub', section: 'me' })}
          aria-label="Settings"
          title="Settings — signing in, feedback"
          className="flex size-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink"
        >
          <Settings size={16} aria-hidden />
        </button>

        <ThemeToggle />

        <Button onClick={() => void startCrash('')}>
          <Car size={15} aria-hidden />
          New crash
        </Button>

        {/*
          Started from here when there is no report yet — a warrant service, or
          an assist for another agency. The usual way in is the arrestee on a
          report, which fills the case and the person in already.
        */}
        <Button onClick={() => void startArrest({})}>
          <Gavel size={15} aria-hidden />
          New arrest
        </Button>

        <Button variant="primary" onClick={createNew}>
          <FilePlus2 size={15} aria-hidden />
          New report
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <nav
            className="mb-5 grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-5"
            aria-label="Where to go"
          >
            {/*
              The four an officer reaches for on a shift. Board is not among
              them because the board is on this page — a button to the thing
              directly below it is a button nobody needs.
            */}
            <GoCard
              icon={<FolderOpen size={14} />}
              label="Cases"
              hint="What you are working on"
              onClick={() => onGo({ kind: 'cases' })}
            />
            <GoCard
              icon={<Search size={14} />}
              label="Master search"
              hint="People, vehicles, places"
              onClick={() => onGo({ kind: 'master' })}
            />
            <GoCard
              icon={<Moon size={14} />}
              label="Shift briefing"
              hint="What the last shift left"
              onClick={() => onGo({ kind: 'briefing' })}
            />
            <GoCard
              icon={<KeyRound size={14} />}
              label="Custody"
              hint="Who is in the building"
              onClick={() => onGo({ kind: 'hub', section: 'work', start: 'custody' })}
            />

            <Tools>
              <ToolItem
                icon={<Boxes size={14} />}
                label="Property room"
                onClick={() => onGo({ kind: 'hub', section: 'work', start: 'evidence' })}
              />
              <ToolItem
                icon={<SignpostBig size={14} />}
                label="Traffic stops"
                onClick={() => onGo({ kind: 'hub', section: 'work', start: 'stops' })}
              />
              <ToolItem
                icon={<Truck size={14} />}
                label="Fleet"
                onClick={() => onGo({ kind: 'hub', section: 'work', start: 'fleet' })}
              />
              <ToolItem
                icon={<BarChart3 size={14} />}
                label="Activity report"
                onClick={() => onGo({ kind: 'hub', section: 'work', start: 'activity' })}
              />
              {mayHandlePublicRecords && (
                <ToolItem
                  icon={<Inbox size={14} />}
                  label="Public records"
                  onClick={() => onGo({ kind: 'hub', section: 'work', start: 'publicRecords' })}
                />
              )}
              {mayReview && (
                <ToolItem
                  icon={<TrendingUp size={14} />}
                  label="Crime trends"
                  onClick={() => onGo({ kind: 'hub', section: 'work', start: 'trends' })}
                />
              )}
              {/* Setting the agency up is a different job from working in it. */}
              {mayConfigureAgency && (
                <ToolItem
                  icon={<Building2 size={14} />}
                  label="Agency setup"
                  onClick={() => onGo({ kind: 'hub', section: 'agency' })}
                />
              )}
            </Tools>
          </nav>

          {/*
            The board, and nothing under it.

            A BOLO nobody happened to click on is a BOLO nobody was told, and
            the officer this is for is about to walk out of the door. It is the
            page rather than a panel on it.
          */}
          <BoardPanel onOpenBoard={() => onGo({ kind: 'board' })} />
        </div>
      </div>
    </div>
  );
}

function GoCard({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col justify-between gap-2 rounded-xl border border-line bg-surface p-3.5 text-left transition hover:border-line-strong hover:bg-raised"
    >
      <span className="text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        <span className="block text-[11.5px] leading-snug text-faint">{hint}</span>
      </span>
    </button>
  );
}

/**
 * The rest, behind one button.
 *
 * A File menu, in the sense somebody already understands: things used
 * occasionally by everybody and constantly by nobody. Closes on Escape and on
 * a press outside, because a menu that stays open while somebody works around
 * it is a menu they close by reloading.
 */
function Tools({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={holder} className="relative h-full" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-full w-full flex-col justify-between gap-2 rounded-xl border p-3.5 text-left transition',
          open
            ? 'border-line-strong bg-raised'
            : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
        )}
      >
        <span className="flex w-full items-center justify-between">
          <Wrench size={14} className="text-muted" aria-hidden />
          <ChevronDown
            size={14}
            className={cn('text-faint transition', open && 'rotate-180')}
            aria-hidden
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-ink">Tools</span>
          <span className="block text-[11.5px] leading-snug text-faint">
            Property, fleet, reports
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ToolItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink transition hover:bg-raised"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
