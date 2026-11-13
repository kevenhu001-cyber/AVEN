import { redirect } from 'next/navigation';

export default async function PluginDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/apps/${encodeURIComponent(id)}`);
}
