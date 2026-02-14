import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

const getDashboardStatsMock = vi.fn();
const getPatientHistoryMock = vi.fn();
const createPatientMock = vi.fn();
const generateDailyInsightsMock = vi.fn();

vi.mock('../lib/api', () => ({
  getDashboardStats: () => getDashboardStatsMock(),
  getPatientHistory: (...args: unknown[]) => getPatientHistoryMock(...args),
  createPatient: (...args: unknown[]) => createPatientMock(...args),
}));

vi.mock('../lib/ai', () => ({
  generateDailyInsights: (...args: unknown[]) => generateDailyInsightsMock(...args),
}));

describe('AdminPage', () => {
  beforeEach(() => {
    getDashboardStatsMock.mockReset();
    getPatientHistoryMock.mockReset();
    createPatientMock.mockReset();
    generateDailyInsightsMock.mockReset();

    getDashboardStatsMock.mockResolvedValue({
      totalVisitsToday: 20,
      totalWaitingNow: 5,
      avgPredictedWait: 9.5,
      busiestSpid: 'MED',
      busiestDoctor: 'Dr. Aye Chan',
      cancelledCount: 1,
      byDoctor: [{ doctor_id: '1', doctor_name: 'Dr. Aye Chan', queue: 5 }],
      bySpid: [{ spid: 'MED', visits: 15, waiting: 5 }],
      hourlyTrend: [{ hour: '10:00', visits: 6 }],
      peakTime: '10:00',
    });
  });

  it('keeps generate button disabled before stats load', () => {
    render(<AdminPage />);

    expect(screen.getByRole('button', { name: 'Generate AI Summary' })).toBeDisabled();
  });

  it('shows loading state while generating summary', async () => {
    generateDailyInsightsMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ executive_summary: 'S', bullet_actions: ['A', 'B', 'C'] }), 50)),
    );

    render(<AdminPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh KPI' }));
    await screen.findByText(/Last updated:/i);

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI Summary' }));

    expect(screen.getAllByText('Generating...').length).toBeGreaterThan(0);
  });

  it('renders generated summary and actions on success', async () => {
    generateDailyInsightsMock.mockResolvedValue({
      executive_summary: 'Executive summary text',
      bullet_actions: ['Action 1', 'Action 2', 'Action 3'],
    });

    render(<AdminPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh KPI' }));
    await screen.findByText(/Last updated:/i);

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI Summary' }));

    await screen.findByText('Executive summary text');
    expect(screen.getByText('Action 1')).toBeInTheDocument();
    expect(screen.getByText(/Source:/i)).toBeInTheDocument();
  });

  it('shows API error and retry action on failure', async () => {
    generateDailyInsightsMock.mockRejectedValue(new Error('Quota exceeded'));

    render(<AdminPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh KPI' }));
    await screen.findByText(/Last updated:/i);

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI Summary' }));

    await screen.findByText('Quota exceeded');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows empty summary state initially', () => {
    render(<AdminPage />);
    expect(screen.getByText('No summary yet.')).toBeInTheDocument();
  });

  it('displays user-friendly summary error when request fails', async () => {
    generateDailyInsightsMock.mockRejectedValue(new Error('Failed to generate daily insights'));

    render(<AdminPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh KPI' }));
    await waitFor(() => expect(getDashboardStatsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI Summary' }));

    await screen.findByText('Failed to generate daily insights');
  });
});
