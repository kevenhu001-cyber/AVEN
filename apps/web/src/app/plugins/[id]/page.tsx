import { PluginDirectory } from '../../../features/personal/plugins/directory';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PluginDirectory key={id} pluginId={id} />;
}
