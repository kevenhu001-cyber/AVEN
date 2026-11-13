import { Suspense } from 'react';
import { ChatPageClient } from '@/features/personal/pages/chat-page';

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageClient />
    </Suspense>
  );
}
