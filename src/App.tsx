import { useState } from 'react';
import { useStore } from '@/state/store';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { IncidentEditor } from '@/features/incident/IncidentEditor';
import { AgencySetup } from '@/features/setup/AgencySetup';

export default function App() {
  const { incident } = useStore();
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <div className="h-full">
      {setupOpen && !incident ? (
        <AgencySetup onClose={() => setSetupOpen(false)} />
      ) : incident ? (
        <IncidentEditor />
      ) : (
        <Dashboard onOpenSetup={() => setSetupOpen(true)} />
      )}
    </div>
  );
}
