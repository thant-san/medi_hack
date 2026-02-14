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
    <div className="mx-auto max-w-2xl panel p-6 md:p-8">
      <h1 className="text-2xl font-semibold text-[#1b7948]">Hackathon Demo Entry</h1>
      <p className="mt-2 text-sm text-slate-600">Patient Flow Analytics • Role Selection</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {(['patient', 'doctor', 'admin'] as Role[]).map((role) => (
          <button
            key={role}
            className={`rounded-lg border px-3 py-2 text-sm capitalize transition ${
              selectedRole === role ? 'border-[#1b7948] bg-[#f0fdf4] text-[#1b7948] font-semibold' : 'border-slate-200 bg-white'
            }`}
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
        className="btn-primary mt-6 w-full"
      >
        Enter App
      </button>
    </div>
  );
}
