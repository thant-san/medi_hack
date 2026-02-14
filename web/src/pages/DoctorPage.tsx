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
      <h2 className="text-xl font-semibold">Doctor Dashboard</h2>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <label className="text-sm">Doctor ID (demo)</label>
        <input
          className="w-full rounded-md border px-3 py-2"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          placeholder="Paste doctor uuid"
        />
        <button className="rounded-md bg-brand-600 px-4 py-2 text-white" onClick={callNext} disabled={!nextWaiting}>
          Call Next
        </button>
      </div>

      <div className="rounded-xl border bg-white p-4 overflow-x-auto">
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
                  <button className="rounded border px-2 py-1" onClick={() => markInRoom(entry)}>
                    Mark In Room
                  </button>
                  <button className="rounded border px-2 py-1" onClick={() => markDone(entry)}>
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
