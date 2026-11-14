import { Suspense } from 'react';
import { ChatPageClient } from '@/features/personal/pages/chat-page';

/** The home route opens the same workspace without resetting an existing conversation. */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <ChatPageClient />
    </Suspense>
  );
}
