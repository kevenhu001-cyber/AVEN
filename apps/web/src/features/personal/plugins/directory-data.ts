export const upcomingPlugins = [
  {
    id: 'slack',
    name: 'Slack',
    category: 'productivity',
    description: '让团队消息与工作上下文更容易找到。',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'productivity',
    description: '在对话中探索代码仓库、议题与合并请求。',
  },
  { id: 'discord', name: 'Discord', category: 'social', description: '把社群讨论带入协作场景。' },
  {
    id: 'todoist',
    name: 'Todoist',
    category: 'productivity',
    description: '整理待办事项与下一步行动。',
  },
  {
    id: 'ticktick',
    name: '滴答清单',
    category: 'productivity',
    description: '聚合任务与日程安排。',
  },
  { id: 'feishu', name: '飞书', category: 'productivity', description: '连接团队文档和协作信息。' },
  { id: 'arxiv', name: 'arXiv', category: 'productivity', description: '探索论文与研究方向。' },
  {
    id: 'zotero',
    name: 'Zotero',
    category: 'productivity',
    description: '把文献资料整理为可用的研究上下文。',
  },
  { id: 'baidu_maps', name: '百度地图', category: 'maps', description: '地点与路线服务。' },
] as const;
