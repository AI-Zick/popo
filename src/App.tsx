import { useState } from 'react';
import { useStore } from '@/state/store';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { IncidentEditor } from '@/features/incident/IncidentEditor';
import { AgencySetup } from '@/features/setup/AgencySetup';
import { SignIn } from '@/features/auth/SignIn';
import { ChangePassword } from '@/features/auth/ChangePassword';

export default function App() {
  const { incident, can, isAuthenticated, mustChangePassword } = useStore();
  const [setupOpen, setSetupOpen] = useState(false);

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
