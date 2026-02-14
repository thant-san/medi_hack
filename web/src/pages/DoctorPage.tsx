import { useCallback, useEffect, useMemo, useState } from 'react';
import { createNotification, getDoctorQueue, updateAppointmentStatus, updateQueueStatus } from '../lib/api';
import { DEMO_DOCTOR_ID } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { QueueEntry } from '../lib/types';

export function DoctorPage() {
  const [doctorId, setDoctorId] = useState(DEMO_DOCTOR_ID);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (id = doctorId) => {
      if (!id) return;
      const list = await getDoctorQueue(id);
      setQueue(list);
    },
    [doctorId],
  );

  useEffect(() => {
    if (!doctorId) return;
    const load = async () => {
      try {
        const list = await getDoctorQueue(doctorId);
        setQueue(list);
      } catch {
        setError('Failed to load queue');
      }
    };

    load().catch(() => undefined);
  }, [doctorId]);

  useEffect(() => {
    if (!doctorId) return;
    const sub = supabase
      .channel(`doctor-queue-${doctorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `doctor_id=eq.${doctorId}`,
        },
        () => reload().catch(() => undefined),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [doctorId, reload]);

  const nextWaiting = useMemo(() => queue.find((q) => q.status === 'waiting'), [queue]);

  const callNext = async () => {
    if (!nextWaiting) return;

    await updateQueueStatus(nextWaiting.id, 'called');
    await updateAppointmentStatus(nextWaiting.appointment_id, 'in_consult');
    await createNotification({
      patient_id: nextWaiting.patient_id,
      queue_entry_id: nextWaiting.id,
      type: 'called',
      message: `Queue #${nextWaiting.queue_number} is called. Please proceed to room now.`,
    });
    await reload();
  };

  const markInRoom = async (entry: QueueEntry) => {
    await updateQueueStatus(entry.id, 'in_room');
    await reload();
  };

  const markDone = async (entry: QueueEntry) => {
    await updateQueueStatus(entry.id, 'done');
    await updateAppointmentStatus(entry.appointment_id, 'done');
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="panel bg-gradient-to-r from-[#f0fdf4] to-white p-4">
        <h2 className="text-xl font-semibold text-[#1b7948]">Doctor Dashboard</h2>
        <p className="text-sm text-slate-600">Live queue management and patient flow controls</p>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="panel space-y-3 p-4">
        <label className="text-sm">Doctor ID (demo)</label>
        <input
          className="w-full rounded-md border px-3 py-2"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          placeholder="Paste doctor uuid"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-primary" onClick={callNext} disabled={!nextWaiting}>
            Call Next
          </button>
          <div className="kpi-card sm:col-span-2">
            <div className="kpi-label">Next waiting queue</div>
            <div className="kpi-value">{nextWaiting ? `#${nextWaiting.queue_number} • ${nextWaiting.spid}` : 'No waiting patient'}</div>
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto p-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">Queue #</th>
              <th className="p-2">SPID</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((entry) => (
              <tr key={entry.id} className="border-b">
                <td className="p-2">{entry.queue_number}</td>
                <td className="p-2">{entry.spid}</td>
                <td className="p-2">{entry.status}</td>
                <td className="p-2 space-x-2">
                  <button className="btn-outline !px-2 !py-1" onClick={() => markInRoom(entry)}>
                    Mark In Room
                  </button>
                  <button className="btn-gold !px-2 !py-1" onClick={() => markDone(entry)}>
                    Mark Done
                  </button>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td className="p-2 text-slate-500" colSpan={4}>
                  No active queue entries
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
