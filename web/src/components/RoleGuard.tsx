import { Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Role } from '../lib/types';

type Props = {
  expected: Role;
  currentRole: Role | null;
  children: ReactElement;
};

export function RoleGuard({ expected, currentRole, children }: Props) {
  if (currentRole !== expected) {
    return <Navigate to="/" replace />;
  }

  return children;
}
