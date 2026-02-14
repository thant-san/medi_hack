import { Link, Outlet, useLocation } from 'react-router-dom';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-gradient-to-r from-[#c5951d] to-[#b8860b] text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4">
          <Link to="/" className="text-lg font-semibold md:text-xl">
            Patient Flow Analytics • MFU MCH
          </Link>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs md:text-sm">{location.pathname}</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
