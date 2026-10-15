/**
 * Copy for the knowledge relation map and the 3D graph
 * (components/workspace/knowledge-graph-panel.tsx, knowledge-graph-view.tsx).
 */

export interface KnowledgeMapCopy {
  mapView: string;
  findNode: string;
  findNodeLabel: string;
  filterByType: string;
  allTypes: string;
  depthGlobal: string;
  depthLocal: (hops: number) => string;
  hideOrphans: string;
  showDirection: string;
  noRelations: string;
  mapLabel: string;
  relationCount: (count: number) => string;
  graphSettings: string;
  emptyTitle: string;
  emptyHint: string;
  webglUnavailable: string;
}

const zhCN: KnowledgeMapCopy = {
  mapView: "关系视图",
  findNode: "查找节点",
  findNodeLabel: "查找知识节点",
  filterByType: "按实体类型筛选",
  allTypes: "全部类型",
  depthGlobal: "全局",
  depthLocal: (hops) => `局部 ${hops} 层`,
  hideOrphans: "隐藏孤立",
  showDirection: "方向",
  noRelations: "暂无可视化关系",
  mapLabel: "知识关系图",
  relationCount: (count) => `${count} 条关系`,
  graphSettings: "图谱设置",
  emptyTitle: "暂无图谱数据",
  emptyHint: "先扫描本地文档，生成实体与关系后会显示在这里。",
  webglUnavailable: "这台设备无法绘制 3D 图谱，可以改用关系视图。",
};

const enUS: KnowledgeMapCopy = {
  mapView: "Relation map",
  findNode: "Find a node",
  findNodeLabel: "Find a knowledge node",
  filterByType: "Filter by entity type",
  allTypes: "All types",
  depthGlobal: "All",
  depthLocal: (hops) => `${hops} ${hops === 1 ? "hop" : "hops"}`,
  hideOrphans: "Hide orphans",
  showDirection: "Direction",
  noRelations: "No relations to show yet",
  mapLabel: "Knowledge relation map",
  relationCount: (count) =>
    `${count} ${count === 1 ? "relation" : "relations"}`,
  graphSettings: "Graph settings",
  emptyTitle: "No graph data yet",
  emptyHint:
    "Scan local documents first. Extracted entities and relations appear here.",
  webglUnavailable:
    "This device can't draw the 3D graph. Use the relation map instead.",
};

const jaJP: KnowledgeMapCopy = {
  mapView: "関係ビュー",
  findNode: "ノードを検索",
  findNodeLabel: "知識ノードを検索",
  filterByType: "エンティティの種類で絞り込む",
  allTypes: "すべての種類",
  depthGlobal: "全体",
  depthLocal: (hops) => `近傍 ${hops} 階層`,
  hideOrphans: "孤立ノードを隠す",
  showDirection: "方向",
  noRelations: "表示できる関係はまだありません",
  mapLabel: "知識関係マップ",
  relationCount: (count) => `${count} 件の関係`,
  graphSettings: "グラフ設定",
  emptyTitle: "グラフデータはまだありません",
  emptyHint:
    "まずローカル文書をスキャンしてください。抽出したエンティティと関係がここに表示されます。",
  webglUnavailable:
    "このデバイスでは 3D グラフを描画できません。関係ビューをご利用ください。",
};

const koKR: KnowledgeMapCopy = {
  mapView: "관계 보기",
  findNode: "노드 찾기",
  findNodeLabel: "지식 노드 찾기",
  filterByType: "엔티티 유형으로 필터",
  allTypes: "모든 유형",
  depthGlobal: "전체",
  depthLocal: (hops) => `인접 ${hops}단계`,
  hideOrphans: "고립 노드 숨기기",
  showDirection: "방향",
  noRelations: "아직 표시할 관계가 없습니다",
  mapLabel: "지식 관계도",
  relationCount: (count) => `관계 ${count}개`,
  graphSettings: "그래프 설정",
  emptyTitle: "아직 그래프 데이터가 없습니다",
  emptyHint:
    "먼저 로컬 문서를 스캔하세요. 추출된 엔티티와 관계가 여기에 표시됩니다.",
  webglUnavailable:
    "이 기기에서는 3D 그래프를 그릴 수 없습니다. 관계 보기를 사용하세요.",
};

export function knowledgeMapCopy(locale: string): KnowledgeMapCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
