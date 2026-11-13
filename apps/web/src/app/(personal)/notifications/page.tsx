'use client';

import { useRouter } from 'next/navigation';
import { PageHead } from '@/components/shell/page';
import { NotificationsPanel } from '@/features/personal/notifications-panel';
import { useSession } from '@/features/personal/session';

export default function NotificationsPage() {
  const router = useRouter();
  const { invalidate } = useSession();
  return (
    <div className="page">
      <PageHead title="通知" description="站内通知与通知偏好。移动推送与自动刷新尚未接入。" />
      <NotificationsPanel
        onExpired={invalidate}
        onConnections={() => router.push('/connections')}
      />
    </div>
  );
}
