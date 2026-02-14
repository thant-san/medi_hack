import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_MODE_KEY, ROLE_KEY } from '../lib/constants';
import type { Role } from '../lib/types';

type Props = {
  onRoleChange: (role: Role) => void;
  demoMode: boolean;
  onDemoModeChange: (value: boolean) => void;
};

export function LandingPage({ onRoleChange, demoMode, onDemoModeChange }: Props) {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState<Role>(() => (localStorage.getItem(ROLE_KEY) as Role | null) ?? 'patient');

  const enter = () => {
    localStorage.setItem(ROLE_KEY, selectedRole);
    localStorage.setItem(DEMO_MODE_KEY, String(demoMode));
    onRoleChange(selectedRole);

    if (selectedRole === 'patient') navigate('/patient');
    if (selectedRole === 'doctor') navigate('/doctor');
    if (selectedRole === 'admin') navigate('/admin');
  };

  return (
    <div className="mx-auto max-w-xl rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Hackathon Demo Entry</h1>
      <p className="mt-2 text-sm text-slate-600">Choose role and start demo flow.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {(['patient', 'doctor', 'admin'] as Role[]).map((role) => (
          <button
            key={role}
            className={`rounded-lg border px-3 py-2 text-sm capitalize ${selectedRole === role ? 'border-brand-600 bg-brand-50 text-brand-700' : ''}`}
            onClick={() => setSelectedRole(role)}
          >
            {role}
          </button>
        ))}
      </div>

      <label className="mt-5 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={demoMode} onChange={(e) => onDemoModeChange(e.target.checked)} />
        Demo Mode (frontend role gating, quick switch)
      </label>

      <button
        onClick={enter}
        className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2 text-white transition hover:bg-brand-500"
      >
        Enter App
      </button>
    </div>
  );
}
