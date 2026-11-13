import { AppsCatalog } from '@/features/personal/apps-catalog';

export default async function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppsCatalog key={id} pluginId={id} />;
}
