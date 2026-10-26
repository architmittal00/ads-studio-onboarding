import { redirect } from 'next/navigation';
import ApiLogPanel from '@/launch-ad/components/ApiLogPanel';
import LaunchApp from '@/launch-ad/components/LaunchApp';
import AppShell from '@/launch-ad/components/Sidebar';
import { getSession } from '@/launch-ad/lib/session';
import '@/launch-ad/api-log.css';
import '@/launch-ad/launch.css';

export const dynamic = 'force-dynamic';

export default async function LaunchPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return (
    <AppShell section="launch" user={{ name: session.name, picture: session.picture }}>
      <LaunchApp declined={session.declined || []} />
      <ApiLogPanel />
    </AppShell>
  );
}
