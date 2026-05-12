import type { ReactNode } from 'react';
import { DeskLayout } from '../../components/DeskLayout';

export default function Layout({ children }: { children: ReactNode }) {
  return <DeskLayout>{children}</DeskLayout>;
}
