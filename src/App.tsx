import { useStore } from '@/state/store';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { IncidentEditor } from '@/features/incident/IncidentEditor';

export default function App() {
  const { incident } = useStore();
  return <div className="h-full">{incident ? <IncidentEditor /> : <Dashboard />}</div>;
}
