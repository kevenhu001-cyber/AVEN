export type WorkspacePage =
  'chat' | 'memory' | 'connections' | 'notifications' | 'more' | 'history' | 'account' | 'provider';
export const workspacePages = [
  { id: 'chat', label: '对话', icon: 'message' },
  { id: 'memory', label: '记忆', icon: 'layers' },
  { id: 'connections', label: '连接', icon: 'link' },
  { id: 'notifications', label: '通知', icon: 'bell' },
  { id: 'more', label: '更多', icon: 'grid' },
] as const;
export function primaryPage(page: WorkspacePage) {
  return page === 'account' || page === 'history' || page === 'provider' ? 'more' : page;
}
