import { lazy, Suspense, useState } from 'react';
import { cn } from '@/lib/cn';
import type { SectionKey, Tab as HubTab } from '@/features/setup/AgencySetup';
import { Loader2, ServerCrash } from 'lucide-react';
import { useStore } from '@/state/store';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { IncidentEditor } from '@/features/incident/IncidentEditor';
import { SupplementEditor } from '@/features/supplements/SupplementEditor';
import { CommandSearch, useSearchHotkey } from '@/features/search/CommandSearch';
import { SendFeedback } from '@/features/feedback/SendFeedback';
import { FeedbackButton } from '@/features/feedback/FeedbackButton';
import { SignIn } from '@/features/auth/SignIn';
import { ChangePassword } from '@/features/auth/ChangePassword';
import { SecondFactor } from '@/features/auth/SecondFactor';
import { RecordFile } from '@/features/file/RecordFile';
import { DEMO } from '@/state/api';
import { DemoBar } from '@/features/demo/DemoBar';

/*
  Split off the screens nobody lands on.

  An officer signs in and sees the dashboard, then a report — so the dashboard,
  the incident editor, the supplement editor and search are worth loading up
  front, and paying for them is the price of the app being instant afterwards.

  Setup, the crash editor and the arrest editor are not that. Setup is a records
  clerk's screen and an officer may never open it in a career; the crash editor
  drags in a vector diagram canvas that a burglary report has no use for; most
  shifts end without an arrest. Each is one click behind an explicit action,
  which is exactly the moment a fetch is free.
*/
const AgencySetup = lazy(() =>
  import('@/features/setup/AgencySetup').then((m) => ({ default: m.AgencySetup })),
);
const CrashEditor = lazy(() =>
  import('@/features/crash/CrashEditor').then((m) => ({ default: m.CrashEditor })),
);
const ArrestEditor = lazy(() =>
  import('@/features/arrest/ArrestEditor').then((m) => ({ default: m.ArrestEditor })),
);
const PeopleIndex = lazy(() =>
  import('@/features/index/IndexPages').then((m) => ({ default: m.PeopleIndex })),
);
const VehicleIndex = lazy(() =>
  import('@/features/index/IndexPages').then((m) => ({ default: m.VehicleIndex })),
);
const BoardScreen = lazy(() =>
  import('@/features/board/Board').then((m) => ({ default: m.BoardScreen })),
);

/**
 * Shown while one of those arrives. Deliberately quiet: on any normal
 * connection it is gone before it is read, and a spinner that flashes for
 * eighty milliseconds is worse than nothing.
 */
function ScreenLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <p className="flex items-center gap-2 text-[13.5px] text-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        Opening…
      </p>
    </div>
  );
}

export default function App() {
  const {
    incident,
    supplement,
    crash,
    arrest,
    isAuthenticated,
    mustChangePassword,
    secondFactor,
    recoveryCodes,
    loading,
    connectionError,
  } = useStore();
  /*
    Where the app is, when it is not on a report.

    One piece of state rather than a flag per destination: the home page now
    opens several screens, and a set of independent booleans is how two of them
    end up on screen at once.
  */
  const [away, setAway] = useState<
    | null
    | { kind: 'hub'; section: SectionKey; start?: HubTab }
    | { kind: 'people' }
    | { kind: 'vehicles' }
    | { kind: 'board' }
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  useSearchHotkey(() => setSearchOpen(true));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <p className="flex items-center gap-2 text-[13.5px] text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Connecting…
        </p>
      </div>
    );
  }

  // A dead API is not a sign-in problem, and should not be reported as one.
  if (connectionError) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-6">
        <div className="max-w-md rounded-xl border border-danger/35 bg-danger-soft p-5">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-danger">
            <ServerCrash size={17} aria-hidden />
            Cannot reach the server
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink/80">{connectionError}</p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Start the API with <code className="rounded bg-surface px-1 font-mono">npm run server</code>{' '}
            in a second terminal, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <SignIn />;
  /*
    Before the password change, not after: an officer who has only proved a
    password cannot be allowed to set a new one, or the second factor would
    protect nothing on an account whose password had just been stolen.
  */
  /*
    `recoveryCodes` keeps this screen up after the sign-in has finished. They
    are readable exactly once and confirming enrolment is what finishes the
    sign-in, so without this the app would render over the top of the only
    chance anybody gets to write them down.
  */
  if (secondFactor || recoveryCodes) return <SecondFactor />;
  // An issued password cannot become the permanent one.
  if (mustChangePassword) return <ChangePassword />;

  return (
    <div className={cn('h-full', DEMO && 'flex flex-col')}>
      {/*
        Only in the published demo. It says what this is and lets a tester
        become somebody else, which is how the separation-of-duties rules
        become visible rather than merely enforced.
      */}
      {DEMO && <DemoBar />}

      {/* Reachable from every screen, because searching is not a screen. */}
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/*
        Nor is reading a record. It opens over whatever is on screen, so a
        lookup in the middle of writing a narrative costs nothing.
      */}
      <RecordFile />

      {/*
        Same reasoning, and more so. Feedback that has to be found is feedback
        nobody sends: the moment worth capturing is the one where somebody is
        annoyed, which is on whatever screen annoyed them.
      */}
      <FeedbackButton onClick={() => setFeedbackOpen(true)} />
      <SendFeedback open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <div className={cn(DEMO ? 'min-h-0 flex-1' : 'h-full')}>
      {away && !incident ? (
        <Suspense fallback={<ScreenLoading />}>
          {away.kind === 'people' ? (
            <PeopleIndex onClose={() => setAway(null)} />
          ) : away.kind === 'vehicles' ? (
            <VehicleIndex onClose={() => setAway(null)} />
          ) : away.kind === 'board' ? (
            <BoardScreen onClose={() => setAway(null)} />
          ) : (
            <AgencySetup section={away.section} start={away.start} onClose={() => setAway(null)} />
          )}
        </Suspense>
      ) : arrest ? (
        // Same reasoning as a crash report, and more so: an arrest outlives the
        // report it came from and is answered for on its own.
        <Suspense fallback={<ScreenLoading />}>
          <ArrestEditor />
        </Suspense>
      ) : crash ? (
        // A crash report is its own document, so it takes the screen the way
        // an incident report does.
        <Suspense fallback={<ScreenLoading />}>
          <CrashEditor />
        </Suspense>
      ) : supplement ? (
        // A supplement takes over the screen: it is its own document, and
        // editing one inside the report it hangs from would blur exactly the
        // line this feature exists to draw.
        <SupplementEditor />
      ) : incident ? (
        <IncidentEditor />
      ) : (
        <Dashboard
          onGo={setAway}
          onOpenSearch={() => setSearchOpen(true)}
        />
      )}
      </div>
    </div>
  );
}
