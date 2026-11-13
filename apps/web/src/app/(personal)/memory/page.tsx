'use client';

import { PageHead } from '@/components/shell/page';
import { MemoriesPanel } from '@/features/personal/memories-panel';
import { useSession } from '@/features/personal/session';

export default function MemoryPage() {
  const { invalidate } = useSession();
  return (
    <div className="page">
      <PageHead
        title="记忆与上下文"
        description="只有你确认过的信息才会进入记忆；用途默认拒绝，可随时编辑或撤回。"
      />
      <MemoriesPanel onExpired={invalidate} />
    </div>
  );
}
