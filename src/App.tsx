import { useState } from 'react';
import { Loader2, ServerCrash } from 'lucide-react';
import { useStore } from '@/state/store';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { IncidentEditor } from '@/features/incident/IncidentEditor';
import { AgencySetup } from '@/features/setup/AgencySetup';
import { SignIn } from '@/features/auth/SignIn';
import { ChangePassword } from '@/features/auth/ChangePassword';

export default function App() {
  const { incident, can, isAuthenticated, mustChangePassword, loading, connectionError } =
    useStore();
  const [setupOpen, setSetupOpen] = useState(false);

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
      {setupOpen && !incident && (can('agency.configure') || can('users.manage') || can('audit.view')) ? (
        <AgencySetup onClose={() => setSetupOpen(false)} />
      ) : incident ? (
        <IncidentEditor />
      ) : (
        <Dashboard onOpenSetup={() => setSetupOpen(true)} />
      )}
    </div>
  );
}
