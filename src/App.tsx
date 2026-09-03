import { lazy, Suspense, useState } from 'react';
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

/*
  Split off the two screens nobody lands on.

  An officer signs in and sees the dashboard, then a report — so the dashboard,
  the incident editor, the supplement editor and search are worth loading up
  front, and paying for them is the price of the app being instant afterwards.

  Setup and the crash editor are not that. Setup is a records clerk's screen and
  an officer may never open it in a career; the crash editor drags in a vector
  diagram canvas that a burglary report has no use for. Both are one click
  behind an explicit action, which is exactly the moment a fetch is free.
*/
const AgencySetup = lazy(() =>
  import('@/features/setup/AgencySetup').then((m) => ({ default: m.AgencySetup })),
);
const CrashEditor = lazy(() =>
  import('@/features/crash/CrashEditor').then((m) => ({ default: m.CrashEditor })),
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
  const { incident, supplement, crash, isAuthenticated, mustChangePassword, loading, connectionError } =
    useStore();
  const [setupOpen, setSetupOpen] = useState(false);
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
  // An issued password cannot become the permanent one.
  if (mustChangePassword) return <ChangePassword />;

  return (
    <div className="h-full">
      {/* Reachable from every screen, because searching is not a screen. */}
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/*
        Same reasoning, and more so. Feedback that has to be found is feedback
        nobody sends: the moment worth capturing is the one where somebody is
        annoyed, which is on whatever screen annoyed them.
      */}
      <FeedbackButton onClick={() => setFeedbackOpen(true)} />
      <SendFeedback open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {setupOpen && !incident ? (
        <Suspense fallback={<ScreenLoading />}>
          <AgencySetup onClose={() => setSetupOpen(false)} />
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
        <Dashboard onOpenSetup={() => setSetupOpen(true)} />
      )}
    </div>
  );
}
