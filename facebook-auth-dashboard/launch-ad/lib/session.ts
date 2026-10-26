import 'server-only';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

export interface Session {
  token: string;
  userId: string;
  name: string;
  picture?: string;
  declined: string[];
  tokenExpiresAt?: number;
}

/** Reuses this dashboard's NextAuth login instead of sr-ads-launch's own Facebook OAuth + cookie. */
export async function getSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return null;
  return {
    token: session.accessToken,
    userId: session.user?.email || '',
    name: session.user?.name || 'User',
    picture: session.user?.image || undefined,
    declined: [],
  };
}
