'use client';

import { PageHead } from '@/components/shell/page';
import { ConnectionsPanel } from '@/features/personal/connections-panel';
import { useSession } from '@/features/personal/session';

export default function ConnectionsPage() {
  const { me, invalidate } = useSession();
  if (!me) return null;
  return (
    <div className="page">
      <PageHead
        title="我的连接"
        description="连接邀请、共享预览与会话消息。撤销后新的授权检查会立即拒绝。"
      />
      <ConnectionsPanel userId={me.user.id} onExpired={invalidate} />
    </div>
  );
}
