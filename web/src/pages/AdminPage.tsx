import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { generateDailyInsights } from '../lib/ai';
import { adminCreateUser, getDashboardStats, getPatientHistory } from '../lib/api';

export function AdminPage() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getDashboardStats>> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [hnxSearch, setHnxSearch] = useState('');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getPatientHistory>> | null>(null);

  const [insightLoading, setInsightLoading] = useState(false);
  const [insightText, setInsightText] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [createRole, setCreateRole] = useState<'patient' | 'doctor' | 'admin'>('patient');
  const [createIdNumber, setCreateIdNumber] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createDoctorSpid, setCreateDoctorSpid] = useState('');
  const [createDoctorRoom, setCreateDoctorRoom] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);

  const loadStats = async () => {
    setLoadingStats(true);
    setError(null);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch {
      setError('Failed to load dashboard stats.');
    } finally {
      setLoadingStats(false);
    }
  };

  const loadHistory = async () => {
    try {
      setError(null);
      const data = await getPatientHistory(hnxSearch.trim());
      setHistory(data);
    } catch {
      setError('Failed to search patient history.');
    }
  };

  const avgPredictedWait = useMemo(() => stats?.avgPredictedWait ?? 0, [stats]);

  const generateSummary = async () => {
    if (!stats) return;
    setInsightLoading(true);
    setError(null);
    try {
      const result = await generateDailyInsights({
        date: new Date().toISOString(),
        metrics: {
          total_visits: stats.totalVisitsToday,
          avg_wait: avgPredictedWait,
          peak_time: stats.peakTime,
          top_overloaded_spid: stats.busiestSpid,
          top_doctor_queue: stats.busiestDoctor,
          queue_by_doctor: stats.byDoctor,
          queue_by_spid: stats.bySpid,
        },
      });

      setInsightText(result.executive_summary);
      setActions(result.bullet_actions);
    } catch {
      setError('Could not generate AI insight.');
    } finally {
      setInsightLoading(false);
    }
  };

  const submitCreateUser = async () => {
    if (!createIdNumber.trim() || !createFullName.trim() || createPassword.length < 6) {
      setError('Please fill required user fields and set password >= 6 chars.');
      return;
    }

    if (createRole === 'doctor' && !createDoctorSpid.trim()) {
      setError('Doctor role requires SPID.');
      return;
    }

    setCreateLoading(true);
    setError(null);
    setCreateResult(null);

    try {
      const created = await adminCreateUser({
        role: createRole,
        id_number: createIdNumber.trim(),
        full_name: createFullName.trim(),
        password: createPassword,
        email: createEmail.trim() || null,
        phone: createPhone.trim() || null,
        doctor_spid: createRole === 'doctor' ? createDoctorSpid.trim() || null : null,
        doctor_room_label: createRole === 'doctor' ? createDoctorRoom.trim() || null : null,
      });

      setCreateResult(`Created ${created.role} | Login ID: ${created.login_id} | Login Email: ${created.login_email}`);
      setCreateIdNumber('');
      setCreateFullName('');
      setCreatePassword('');
      setCreateEmail('');
      setCreatePhone('');
      setCreateDoctorSpid('');
      setCreateDoctorRoom('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel bg-gradient-to-r from-[#fef3c7] to-white p-4">
        <h2 className="text-xl font-semibold text-[#1b7948]">Executive Dashboard</h2>
        <p className="text-sm text-slate-600">Real-time monitoring, performance analytics, and AI daily summary</p>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <button className="btn-primary" onClick={loadStats} disabled={loadingStats}>
          {loadingStats ? 'Refreshing...' : 'Refresh KPI'}
        </button>
        <button className="btn-gold" onClick={generateSummary} disabled={!stats || insightLoading}>
          {insightLoading ? 'Generating...' : 'Generate AI Summary'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card title="Total Visits Today" value={stats?.totalVisitsToday ?? '-'} />
        <Card title="Current Waiting" value={stats?.totalWaitingNow ?? '-'} />
        <Card title="Avg Predicted Wait" value={`${avgPredictedWait || '-'} min`} />
        <Card title="Busiest SPID" value={stats?.busiestSpid ?? '-'} />
        <Card title="Busiest Doctor" value={stats?.busiestDoctor ?? '-'} />
        <Card title="No-show/Cancelled" value={stats?.cancelledCount ?? '-'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-3 font-semibold text-[#1b7948]">Queue by Doctor</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.byDoctor ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="doctor_name" interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="queue" fill="#1b7948" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-3 font-semibold text-[#1b7948]">SPID Volume Breakdown</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats?.bySpid ?? []} dataKey="visits" nameKey="spid" outerRadius={90} fill="#c5951d" label />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold text-[#1b7948]">Hourly Visit Trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.hourlyTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="visits" stroke="#1b7948" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-semibold text-[#1b7948]">Patient Search by HN</h3>
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border px-3 py-2"
            value={hnxSearch}
            onChange={(e) => setHnxSearch(e.target.value)}
            placeholder="Search HN"
          />
          <button className="btn-outline" onClick={loadHistory}>
            Search
          </button>
        </div>

        {history?.patient ? (
          <div className="text-sm space-y-1">
            <p>HN: {history.patient.hnx}</p>
            <p>Name: {history.patient.display_name ?? '-'}</p>
            <p>Last SPID: {history.records[0]?.spid ?? '-'}</p>
            <p>Suggested doctor: {history.suggestedDoctor?.name ?? 'No mapping found'}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No result yet.</p>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-semibold text-[#1b7948]">Create User (Admin)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Role</span>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value as 'patient' | 'doctor' | 'admin')}
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span>ID Number</span>
            <input className="w-full rounded-md border px-3 py-2" value={createIdNumber} onChange={(e) => setCreateIdNumber(e.target.value)} />
          </label>

          <label className="space-y-1 text-sm">
            <span>Full Name</span>
            <input className="w-full rounded-md border px-3 py-2" value={createFullName} onChange={(e) => setCreateFullName(e.target.value)} />
          </label>

          <label className="space-y-1 text-sm">
            <span>Password</span>
            <input
              type="password"
              className="w-full rounded-md border px-3 py-2"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Email (optional)</span>
            <input className="w-full rounded-md border px-3 py-2" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} />
          </label>

          <label className="space-y-1 text-sm">
            <span>Phone (optional)</span>
            <input className="w-full rounded-md border px-3 py-2" value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} />
          </label>

          {createRole === 'doctor' && (
            <>
              <label className="space-y-1 text-sm">
                <span>Doctor SPID</span>
                <input className="w-full rounded-md border px-3 py-2" value={createDoctorSpid} onChange={(e) => setCreateDoctorSpid(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Doctor Room</span>
                <input className="w-full rounded-md border px-3 py-2" value={createDoctorRoom} onChange={(e) => setCreateDoctorRoom(e.target.value)} />
              </label>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button className="btn-primary" onClick={submitCreateUser} disabled={createLoading}>
            {createLoading ? 'Creating...' : 'Create User'}
          </button>
        </div>

        {createResult && <p className="rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-700">{createResult}</p>}
      </div>

      {insightText && (
        <div className="panel space-y-3 p-4">
          <h3 className="font-semibold text-[#1b7948]">AI Daily Executive Insight</h3>
          <p className="whitespace-pre-line text-sm text-slate-700">{insightText}</p>
          <ul className="list-disc pl-5 text-sm">
            {actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{title}</p>
      <p className="kpi-value">{value}</p>
    </div>
  );
}
