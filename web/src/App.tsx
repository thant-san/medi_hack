import { useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RoleGuard } from './components/RoleGuard';
import { DEMO_MODE_KEY, ROLE_KEY } from './lib/constants';
import type { Role } from './lib/types';
import { AdminPage } from './pages/AdminPage';
import { DoctorPage } from './pages/DoctorPage';
import { LandingPage } from './pages/LandingPage';
import { PatientPage } from './pages/PatientPage';

function App() {
  const [role, setRole] = useState<Role | null>(() => (localStorage.getItem(ROLE_KEY) as Role | null) ?? null);
  const [demoMode, setDemoMode] = useState<boolean>(() => localStorage.getItem(DEMO_MODE_KEY) !== 'false');

  const currentRole = useMemo(() => role, [role]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route
            index
            element={<LandingPage onRoleChange={setRole} demoMode={demoMode} onDemoModeChange={setDemoMode} />}
          />
          <Route
            path="patient"
            element={
              demoMode ? (
                <RoleGuard expected="patient" currentRole={currentRole}>
                  <PatientPage />
                </RoleGuard>
              ) : (
                <PatientPage />
              )
            }
          />
          <Route
            path="doctor"
            element={
              demoMode ? (
                <RoleGuard expected="doctor" currentRole={currentRole}>
                  <DoctorPage />
                </RoleGuard>
              ) : (
                <DoctorPage />
              )
            }
          />
          <Route
            path="admin"
            element={
              demoMode ? (
                <RoleGuard expected="admin" currentRole={currentRole}>
                  <AdminPage />
                </RoleGuard>
              ) : (
                <AdminPage />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
