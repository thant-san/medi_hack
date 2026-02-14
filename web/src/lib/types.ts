export type Role = 'patient' | 'doctor' | 'admin';

export type Patient = {
  id: string;
  hnx: string;
  display_name: string | null;
  dob: string | null;
  phone: string | null;
  created_at: string;
};

export type ScreeningRecord = {
  id: string;
  patient_id: string;
  hnx: string;
  modify_time: string;
  spid: string;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  sbp: number | null;
  dbp: number | null;
  chief_complaint: string | null;
  illness_detail: string | null;
  source: 'import' | 'app';
  created_at: string;
};

export type Doctor = {
  id: string;
  name: string;
  spid: string;
  room_label: string | null;
  is_active: boolean;
};

export type Appointment = {
  id: string;
  patient_id: string;
  doctor_id: string;
  spid: string;
  visit_reason: string;
  complaint: string | null;
  status: 'scheduled' | 'waiting' | 'in_consult' | 'done' | 'cancelled';
  created_at: string;
};

export type QueueEntry = {
  id: string;
  appointment_id: string;
  doctor_id: string;
  patient_id: string;
  spid: string;
  queue_number: number;
  priority: number;
  status: 'waiting' | 'called' | 'in_room' | 'done';
  created_at: string;
  called_at: string | null;
  done_at: string | null;
};

export type NotificationItem = {
  id: string;
  patient_id: string;
  queue_entry_id: string;
  type: 'near_turn' | 'called' | 'info';
  message: string;
  delivered: boolean;
  created_at: string;
};

export type PredictedWait = {
  predicted_minutes: number;
  confidence_low: number;
  confidence_high: number;
};

export type DailyInsightsResponse = {
  executive_summary: string;
  bullet_actions: string[];
};
