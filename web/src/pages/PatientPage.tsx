import { useEffect, useMemo, useState } from 'react';
import {
  countPeopleAhead,
  createAppointmentAndQueue,
  createNotification,
  createPatient,
  createScreeningRecord,
  findPatientByHnx,
  getDoctorById,
  getDoctorsBySpid,
  getLatestScreeningByPatient,
  getMappedDoctorForPatient,
  getPatientActiveQueue,
  getPatientNotifications,
  markNotificationDelivered,
} from '../lib/api';
import { CLINICS } from '../lib/constants';
import { predictWait } from '../lib/ai';
import { supabase } from '../lib/supabase';
import type { Doctor, NotificationItem, Patient, QueueEntry, ScreeningRecord } from '../lib/types';

type Step = 'choose' | 'search' | 'sameProblem' | 'screening' | 'dashboard';

export function PatientPage() {
  const [step, setStep] = useState<Step>('choose');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hnx, setHnx] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lastScreening, setLastScreening] = useState<ScreeningRecord | null>(null);

  const [complaint, setComplaint] = useState('');
  const [illnessDetail, setIllnessDetail] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [sbp, setSbp] = useState('');
  const [dbp, setDbp] = useState('');
  const [selectedSpid, setSelectedSpid] = useState(CLINICS[0]);

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [doctorOptions, setDoctorOptions] = useState<Doctor[]>([]);

  const [activeQueue, setActiveQueue] = useState<QueueEntry | null>(null);
  const [peopleAhead, setPeopleAhead] = useState(0);
  const [prediction, setPrediction] = useState<{ predicted: number; low: number; high: number } | null>(null);
  const [doctorRoom, setDoctorRoom] = useState<string>('');

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const bmi = useMemo(() => {
    const w = Number(weight);
    const h = Number(height);
    if (!w || !h) return null;
    const m = h / 100;
    return Number((w / (m * m)).toFixed(1));
  }, [weight, height]);

  const fetchActiveQueue = async (patientId: string) => {
    const queue = await getPatientActiveQueue(patientId);
    setActiveQueue(queue);

    if (!queue) return;

    const ahead = await countPeopleAhead(queue);
    setPeopleAhead(ahead);

    const predicted = await predictWait({
      doctor_id: queue.doctor_id,
      spid: queue.spid,
      patients_ahead: ahead,
      current_time: new Date().toISOString(),
    });
    setPrediction({
      predicted: predicted.predicted_minutes,
      low: predicted.confidence_low,
      high: predicted.confidence_high,
    });

    const doctor = await getDoctorById(queue.doctor_id);
    setDoctorRoom(doctor?.room_label ?? 'N/A');

    if (ahead <= 3 || predicted.predicted_minutes <= 10) {
      await createNotification({
        patient_id: patientId,
        queue_entry_id: queue.id,
        type: 'near_turn',
        message: `You are near your turn at ${queue.spid}. Please stay ready.`,
      }).catch(() => undefined);
    }
  };

  const fetchNotifications = async (patientId: string) => {
    const items = await getPatientNotifications(patientId);
    setNotifications(items);
  };

  useEffect(() => {
    if (!patient) return;

    fetchNotifications(patient.id).catch(() => undefined);

    const queueSub = supabase
      .channel(`patient-queue-${patient.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `patient_id=eq.${patient.id}`,
        },
        () => {
          fetchActiveQueue(patient.id).catch(() => undefined);
        },
      )
      .subscribe();

    const notificationSub = supabase
      .channel(`patient-notification-${patient.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `patient_id=eq.${patient.id}`,
        },
        () => {
          fetchNotifications(patient.id).catch(() => undefined);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(queueSub);
      supabase.removeChannel(notificationSub);
    };
  }, [patient]);

  const searchHn = async () => {
    try {
      setError(null);
      setLoading(true);
      const found = await findPatientByHnx(hnx.trim());
      if (!found) {
        setError('HN not found. Please choose New patient.');
        return;
      }

      const latest = await getLatestScreeningByPatient(found.id);
      setPatient(found);
      setLastScreening(latest);
      setStep('sameProblem');
    } catch {
      setError('Failed to search patient by HN.');
    } finally {
      setLoading(false);
    }
  };

  const proceedSameProblem = async () => {
    if (!patient || !lastScreening) return;

    try {
      setLoading(true);
      const mappedDoctor = await getMappedDoctorForPatient(patient.id);
      let doctor = mappedDoctor;

      if (!doctor) {
        const doctors = await getDoctorsBySpid(lastScreening.spid);
        doctor = doctors[0] ?? null;
      }

      if (!doctor) {
        setError('No active doctor found for previous clinic. Please do new screening.');
        setStep('screening');
        return;
      }

      await createAppointmentAndQueue({
        patient_id: patient.id,
        doctor_id: doctor.id,
        spid: doctor.spid,
        visit_reason: 'follow-up',
        complaint: lastScreening.chief_complaint ?? undefined,
      });

      await fetchActiveQueue(patient.id);
      await fetchNotifications(patient.id);
      setStep('dashboard');
    } catch {
      setError('Could not create follow-up appointment.');
    } finally {
      setLoading(false);
    }
  };

  const startNewPatientFlow = () => {
    const generated = `NEW-${Math.floor(100000 + Math.random() * 900000)}`;
    setHnx(generated);
    setStep('screening');
  };

  const loadDoctorsForSpid = async (spid: string) => {
    const docs = await getDoctorsBySpid(spid);
    setDoctorOptions(docs);
    setSelectedDoctor(docs[0] ?? null);
  };

  useEffect(() => {
    loadDoctorsForSpid(selectedSpid).catch(() => undefined);
  }, [selectedSpid]);

  const submitScreening = async () => {
    try {
      setError(null);
      setLoading(true);

      let currentPatient = patient;
      if (!currentPatient) {
        currentPatient = await createPatient(hnx.trim() || `NEW-${Date.now()}`);
        setPatient(currentPatient);
      }

      await createScreeningRecord({
        patient_id: currentPatient.id,
        hnx: currentPatient.hnx,
        spid: selectedSpid,
        chief_complaint: complaint,
        illness_detail: illnessDetail,
        weight: weight ? Number(weight) : null,
        height: height ? Number(height) : null,
        bmi,
        sbp: sbp ? Number(sbp) : null,
        dbp: dbp ? Number(dbp) : null,
      });

      const doctor = selectedDoctor ?? (await getDoctorsBySpid(selectedSpid))[0];
      if (!doctor) {
        setError('No active doctor available in selected clinic.');
        return;
      }

      await createAppointmentAndQueue({
        patient_id: currentPatient.id,
        doctor_id: doctor.id,
        spid: selectedSpid,
        visit_reason: 'new symptom',
        complaint,
      });

      await fetchActiveQueue(currentPatient.id);
      await fetchNotifications(currentPatient.id);
      setStep('dashboard');
    } catch {
      setError('Failed to submit screening and join queue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel bg-gradient-to-r from-[#fef3c7] to-white p-4">
        <h2 className="text-xl font-semibold text-[#1b7948]">Patient Portal</h2>
        <p className="text-sm text-slate-600">Screening, queue tracking, and real-time notifications</p>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {step === 'choose' && (
        <div className="panel p-5">
          <p className="mb-4 text-sm text-slate-600">Start your visit</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn-primary" onClick={() => setStep('search')}>
              I have HN
            </button>
            <button className="btn-outline" onClick={startNewPatientFlow}>
              New patient
            </button>
          </div>
        </div>
      )}

      {step === 'search' && (
        <div className="panel p-5">
          <label className="text-sm">Enter HN</label>
          <div className="mt-2 flex gap-2">
            <input className="w-full rounded-md border px-3 py-2" value={hnx} onChange={(e) => setHnx(e.target.value)} />
            <button className="btn-primary" onClick={searchHn} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {step === 'sameProblem' && patient && (
        <div className="panel space-y-3 p-5">
          <p className="text-sm text-slate-600">Found patient HN: {patient.hnx}</p>
          {lastScreening && (
            <div className="rounded-md bg-[#f0fdf4] p-3 text-sm border border-[#bbf7d0]">
              Last clinic: <b>{lastScreening.spid}</b> | Complaint: {lastScreening.chief_complaint ?? '-'}
            </div>
          )}
          <p className="font-medium">Same problem as last time?</p>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={proceedSameProblem}>
              Yes, quick follow-up
            </button>
            <button className="btn-outline" onClick={() => setStep('screening')}>
              No, new screening
            </button>
          </div>
        </div>
      )}

      {step === 'screening' && (
        <div className="panel space-y-4 p-5">
          <h3 className="font-semibold text-[#1b7948]">Screening Form</h3>
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="Chief complaint"
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border px-3 py-2"
            placeholder="Illness detail"
            value={illnessDetail}
            onChange={(e) => setIllnessDetail(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-4">
            <input className="rounded-md border px-3 py-2" placeholder="Weight" value={weight} onChange={(e) => setWeight(e.target.value)} />
            <input className="rounded-md border px-3 py-2" placeholder="Height" value={height} onChange={(e) => setHeight(e.target.value)} />
            <input className="rounded-md border px-3 py-2" placeholder="SBP" value={sbp} onChange={(e) => setSbp(e.target.value)} />
            <input className="rounded-md border px-3 py-2" placeholder="DBP" value={dbp} onChange={(e) => setDbp(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Clinic (SPID)</label>
            <select
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={selectedSpid}
              onChange={(e) => setSelectedSpid(e.target.value)}
            >
              {CLINICS.map((spid) => (
                <option value={spid} key={spid}>
                  {spid}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm">Doctor</label>
            <select
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={selectedDoctor?.id ?? ''}
              onChange={(e) => setSelectedDoctor(doctorOptions.find((doc) => doc.id === e.target.value) ?? null)}
            >
              {doctorOptions.map((doc) => (
                <option value={doc.id} key={doc.id}>
                  {doc.name} ({doc.room_label ?? 'Room TBD'})
                </option>
              ))}
            </select>
          </div>
              <button className="btn-primary" onClick={submitScreening} disabled={loading}>
            {loading ? 'Submitting...' : 'Confirm & Join Queue'}
          </button>
        </div>
      )}

      {step === 'dashboard' && patient && (
        <div className="grid gap-4 lg:grid-cols-3">
              <div className="panel space-y-3 p-5 lg:col-span-2">
                <h3 className="font-semibold text-[#1b7948]">Patient Dashboard</h3>
            <p className="text-sm text-slate-600">HN: {patient.hnx}</p>
            {activeQueue ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                      <div className="kpi-card">
                    <p className="text-xs text-slate-500">Queue Number</p>
                        <p className="kpi-value">{activeQueue.queue_number}</p>
                  </div>
                      <div className="kpi-card">
                    <p className="text-xs text-slate-500">People Ahead</p>
                        <p className="kpi-value">{peopleAhead}</p>
                  </div>
                      <div className="kpi-card">
                    <p className="text-xs text-slate-500">Doctor Room</p>
                        <p className="kpi-value text-[#2563eb]">{doctorRoom}</p>
                  </div>
                </div>
                    <div className="rounded-md border border-[#fde68a] bg-[#fffbeb] p-3 text-sm">
                  Predicted Wait: <b>{prediction?.predicted ?? '-'} min</b>
                  {prediction && (
                    <span className="ml-2 text-slate-500">({prediction.low}-{prediction.high} min)</span>
                  )}
                </div>
                <div className="rounded-md border p-3 text-sm">
                  Status Timeline: scheduled → waiting → called → done
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No active queue entry yet.</p>
            )}
          </div>

              <div className="panel p-5">
                <h4 className="mb-2 font-semibold text-[#1b7948]">Notifications</h4>
            <div className="space-y-2 text-sm">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  className={`w-full rounded-md border px-3 py-2 text-left ${!n.delivered ? 'border-brand-500 bg-brand-50' : ''}`}
                  onClick={() => {
                    if (!n.delivered) {
                      markNotificationDelivered(n.id)
                        .then(() => fetchNotifications(patient.id))
                        .catch(() => undefined);
                    }
                  }}
                >
                  <div className="font-medium">{n.type}</div>
                  <div className="text-slate-600">{n.message}</div>
                </button>
              ))}
              {notifications.length === 0 && <p className="text-slate-500">No notifications yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
