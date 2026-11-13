'use client';

import { PageHead } from '@/components/shell/page';
import { AccountPanel } from '@/features/personal/account-panel';
import { useSession } from '@/features/personal/session';

export default function AccountPage() {
  const { me, recheck, logout, invalidate } = useSession();
  if (!me) return null;
  return (
    <div className="page">
      <PageHead title="账号与设置" description="登录状态、邮箱验证与模型服务配置。" />
      <AccountPanel
        me={me}
        onRetry={() => void recheck()}
        onLogout={() => void logout()}
        onExpired={invalidate}
      />
    </div>
  );
}
