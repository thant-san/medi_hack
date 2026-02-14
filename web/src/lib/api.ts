import { supabase } from './supabase';
import type {
  Appointment,
  Doctor,
  NotificationItem,
  Patient,
  QueueEntry,
  ScreeningRecord,
} from './types';

const aiBaseUrl = import.meta.env.VITE_AI_BASE_URL || 'http://127.0.0.1:8000';

export type AdminCreateUserPayload = {
  role: 'patient' | 'doctor' | 'admin';
  id_number: string;
  full_name: string;
  password: string;
  email?: string | null;
  phone?: string | null;
  doctor_spid?: string | null;
  doctor_room_label?: string | null;
};

export type AdminCreateUserResult = {
  auth_user_id: string;
  role: 'patient' | 'doctor' | 'admin';
  login_email: string;
  login_id: string;
  patient_id?: string | null;
  doctor_id?: string | null;
};

export async function adminCreateUser(payload: AdminCreateUserPayload): Promise<AdminCreateUserResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error('Admin session missing. Please login again.');
  }

  const res = await fetch(`${aiBaseUrl}/admin/create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as AdminCreateUserResult | { detail?: string };
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail || 'User creation failed');
  }

  return data as AdminCreateUserResult;
}

export async function findPatientByHnx(hnx: string): Promise<Patient | null> {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('hnx', hnx)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createPatient(hnx: string, displayName?: string): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients')
    .insert({ hnx, display_name: displayName ?? null })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function getLatestScreeningByPatient(patientId: string): Promise<ScreeningRecord | null> {
  const { data, error } = await supabase
    .from('screening_records')
    .select('*')
    .eq('patient_id', patientId)
    .order('modify_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createScreeningRecord(payload: Partial<ScreeningRecord> & { patient_id: string; hnx: string; spid: string }): Promise<ScreeningRecord> {
  const { data, error } = await supabase
    .from('screening_records')
    .insert({
      patient_id: payload.patient_id,
      hnx: payload.hnx,
      modify_time: new Date().toISOString(),
      spid: payload.spid,
      weight: payload.weight ?? null,
      height: payload.height ?? null,
      bmi: payload.bmi ?? null,
      sbp: payload.sbp ?? null,
      dbp: payload.dbp ?? null,
      chief_complaint: payload.chief_complaint ?? null,
      illness_detail: payload.illness_detail ?? null,
      source: 'app',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function getDoctorsBySpid(spid: string): Promise<Doctor[]> {
  const { data, error } = await supabase
    .from('doctors')
    .select('*')
    .eq('spid', spid)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getDoctorById(doctorId: string): Promise<Doctor | null> {
  const { data, error } = await supabase.from('doctors').select('*').eq('id', doctorId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMappedDoctorForPatient(patientId: string): Promise<Doctor | null> {
  const { data, error } = await supabase
    .from('doctor_patient_map')
    .select('doctor_id, doctors(*)')
    .eq('patient_id', patientId)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { doctors: Doctor } | null)?.doctors ?? null;
}

export async function createAppointmentAndQueue(payload: {
  patient_id: string;
  doctor_id: string;
  spid: string;
  visit_reason: string;
  complaint?: string;
}): Promise<{ appointment: Appointment; queueEntry: QueueEntry }> {
  const { data: appointment, error: appointmentErr } = await supabase
    .from('appointments')
    .insert({
      patient_id: payload.patient_id,
      doctor_id: payload.doctor_id,
      spid: payload.spid,
      visit_reason: payload.visit_reason,
      complaint: payload.complaint ?? null,
      status: 'waiting',
    })
    .select('*')
    .single();

  if (appointmentErr) throw appointmentErr;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: maxQueue, error: queueErr } = await supabase
    .from('queue_entries')
    .select('queue_number')
    .eq('doctor_id', payload.doctor_id)
    .gte('created_at', startOfDay.toISOString())
    .order('queue_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (queueErr) throw queueErr;

  const queueNumber = (maxQueue?.queue_number ?? 0) + 1;

  const { data: queueEntry, error: entryErr } = await supabase
    .from('queue_entries')
    .insert({
      appointment_id: appointment.id,
      doctor_id: payload.doctor_id,
      patient_id: payload.patient_id,
      spid: payload.spid,
      queue_number: queueNumber,
      status: 'waiting',
      priority: 0,
    })
    .select('*')
    .single();

  if (entryErr) throw entryErr;

  return { appointment, queueEntry };
}

export async function getPatientActiveQueue(patientId: string): Promise<QueueEntry | null> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('patient_id', patientId)
    .in('status', ['waiting', 'called', 'in_room'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getPeopleAhead(queueEntry: QueueEntry): Promise<number> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id', { count: 'exact', head: true })
    .eq('doctor_id', queueEntry.doctor_id)
    .eq('status', 'waiting')
    .lt('queue_number', queueEntry.queue_number);

  if (error) throw error;
  return data ? 0 : 0;
}

export async function countPeopleAhead(queueEntry: QueueEntry): Promise<number> {
  const { count, error } = await supabase
    .from('queue_entries')
    .select('*', { count: 'exact', head: true })
    .eq('doctor_id', queueEntry.doctor_id)
    .eq('status', 'waiting')
    .lt('queue_number', queueEntry.queue_number);

  if (error) throw error;
  return count ?? 0;
}

export async function createNotification(payload: {
  patient_id: string;
  queue_entry_id: string;
  type: 'near_turn' | 'called' | 'info';
  message: string;
}): Promise<void> {
  const { error } = await supabase.from('notifications').insert({ ...payload, delivered: false });
  if (error) throw error;
}

export async function getPatientNotifications(patientId: string): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data ?? [];
}

export async function markNotificationDelivered(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ delivered: true }).eq('id', id);
  if (error) throw error;
}

export async function getDoctorQueue(doctorId: string): Promise<QueueEntry[]> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('doctor_id', doctorId)
    .in('status', ['waiting', 'called', 'in_room'])
    .order('queue_number', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function updateQueueStatus(queueId: string, status: QueueEntry['status']): Promise<void> {
  const payload: Record<string, unknown> = { status };
  if (status === 'called') payload.called_at = new Date().toISOString();
  if (status === 'done') payload.done_at = new Date().toISOString();

  const { error } = await supabase.from('queue_entries').update(payload).eq('id', queueId);
  if (error) throw error;
}

export async function updateAppointmentStatus(appointmentId: string, status: Appointment['status']): Promise<void> {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', appointmentId);
  if (error) throw error;
}

export async function getDashboardStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const [{ data: doctors }, { data: waitingRows }, { data: screeningRows }, { data: cancelledRows }] = await Promise.all([
    supabase.from('doctors').select('id,name'),
    supabase.from('queue_entries').select('doctor_id,spid,status').eq('status', 'waiting'),
    supabase.from('screening_records').select('spid,modify_time').gte('modify_time', startIso),
    supabase.from('appointments').select('id').eq('status', 'cancelled').gte('created_at', startIso),
  ]);

  const doctorNameById = new Map<string, string>();
  for (const doctor of doctors ?? []) {
    doctorNameById.set(doctor.id, doctor.name);
  }

  const totalWaitingNow = waitingRows?.length ?? 0;
  const totalVisitsToday = screeningRows?.length ?? 0;
  const cancelledCount = cancelledRows?.length ?? 0;

  const bySpidQueue = new Map<string, number>();
  const byDoctorQueue = new Map<string, number>();
  for (const row of waitingRows ?? []) {
    bySpidQueue.set(row.spid, (bySpidQueue.get(row.spid) ?? 0) + 1);
    byDoctorQueue.set(row.doctor_id, (byDoctorQueue.get(row.doctor_id) ?? 0) + 1);
  }

  const bySpidVisits = new Map<string, number>();
  const byHourVisits = new Map<string, number>();
  for (const row of screeningRows ?? []) {
    const spid = row.spid || 'UNKNOWN';
    bySpidVisits.set(spid, (bySpidVisits.get(spid) ?? 0) + 1);

    const dt = new Date(row.modify_time);
    const hourLabel = `${String(dt.getHours()).padStart(2, '0')}:00`;
    byHourVisits.set(hourLabel, (byHourVisits.get(hourLabel) ?? 0) + 1);
  }

  const busiestSpid = [...bySpidVisits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
  const busiestDoctorId = [...byDoctorQueue.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
  const busiestDoctor = doctorNameById.get(busiestDoctorId) ?? busiestDoctorId;

  const byDoctor = [...byDoctorQueue.entries()]
    .map(([doctor_id, queue]) => ({
      doctor_id,
      doctor_name: doctorNameById.get(doctor_id) ?? doctor_id,
      queue,
    }))
    .sort((a, b) => b.queue - a.queue);

  const bySpid = [...bySpidVisits.entries()]
    .map(([spid, visits]) => ({ spid, visits, waiting: bySpidQueue.get(spid) ?? 0 }))
    .sort((a, b) => b.visits - a.visits);

  const hourlyTrend = [...byHourVisits.entries()]
    .map(([hour, visits]) => ({ hour, visits }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const peakTime = [...hourlyTrend].sort((a, b) => b.visits - a.visits)[0]?.hour ?? 'N/A';
  const avgPredictedWait = Number(((totalWaitingNow * 7.5) / Math.max(byDoctor.length, 1)).toFixed(1));

  return {
    totalVisitsToday,
    totalWaitingNow,
    avgPredictedWait,
    busiestSpid,
    busiestDoctor,
    cancelledCount,
    byDoctor,
    bySpid,
    hourlyTrend,
    peakTime,
  };
}

export async function getPatientHistory(hnx: string): Promise<{ patient: Patient | null; records: ScreeningRecord[]; suggestedDoctor: Doctor | null }> {
  const patient = await findPatientByHnx(hnx);
  if (!patient) return { patient: null, records: [], suggestedDoctor: null };

  const [{ data, error }, suggestedDoctor] = await Promise.all([
    supabase
      .from('screening_records')
      .select('*')
      .eq('patient_id', patient.id)
      .order('modify_time', { ascending: false })
      .limit(20),
    getMappedDoctorForPatient(patient.id),
  ]);

  if (error) throw error;

  return { patient, records: data ?? [], suggestedDoctor };
}
