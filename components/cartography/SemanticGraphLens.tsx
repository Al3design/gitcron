'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { AlertTriangle, ChevronDown, ChevronUp, FileCode, Layers3, Loader2, Network } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { buildGroupModel, type CartoGroupKeyFile, type CartoGroupModel } from '@/lib/carto-groups';
import {
  CARTO_ROLE_BY_ID,
  CARTO_ROLE_DEFINITIONS,
  classifyCartoRole,
  type CartoRoleDefinition,
  type CartoRoleId,
} from '@/lib/carto-roles';
import type { CartoGraph, CartoGraphStatus, CartoNode } from '@/lib/carto-types';
import { useGitStore } from '@/lib/git-store';
import { cn } from '@/lib/utils';
import styles from './SemanticGraphLens.module.css';

const MAX_FLOW_EDGES = 160;
const MAX_OVERVIEW_NODES_PER_ROLE = 8;
const NODE_W = 176;
const NODE_H = 82;
const GROUP_W = 276;
const GROUP_H = 164;
const GROUP_COLS = 3;
const GROUP_X = 456;
const GROUP_ROW_GAP = 92;
const GROUP_EXPANDED_GAP = 58;
const NODE_X_GAP = 38;
const NODE_Y_GAP = 34;

type SemanticFileNodeData = Record<string, unknown> & {
  kind: 'file';
  cartoNode: CartoNode;
  role: CartoRoleDefinition;
  roleLabel: string;
  relationCount: number;
};

type SemanticGroupNodeData = Record<string, unknown> & {
  kind: 'group';
  role: CartoRoleDefinition;
  roleLabel: string;
  roleDescription: string;
  count: number;
  keyFiles: CartoGroupKeyFile[];
  summary?: string;
  expanded: boolean;
  hiddenCount: number;
  actionLabel: string;
  moreLabel: string;
  keyFilesLabel: string;
  onToggleGroup: (role: CartoRoleId) => void;
};

type SemanticFileFlowNode = FlowNode<SemanticFileNodeData, 'cartoSemanticFile'>;
type SemanticGroupFlowNode = FlowNode<SemanticGroupNodeData, 'cartoSemanticGroup'>;
type SemanticFlowNode = SemanticFileFlowNode | SemanticGroupFlowNode;

type SemanticGraphLensProps = {
  repoPath: string | null;
  status: CartoGraphStatus | null;
  refreshKey: number;
  selectedNodeId: string | null;
  onSelectNode: (node: CartoNode) => void;
};

type RoleGroup = {
  role: CartoRoleDefinition;
  label: string;
  nodes: CartoNode[];
  keyFiles: CartoGroupKeyFile[];
  summary?: string;
};

type GraphModel = {
  nodeById: Map<string, CartoNode>;
  roleByNodeId: Map<string, CartoRoleId>;
  relationCount: Map<string, number>;
  groups: RoleGroup[];
  groupModel: CartoGroupModel;
};

type GraphFetchState = {
  key: string;
  graph: CartoGraph | null;
  error: string | null;
  loading: boolean;
};

const nodeTypes: NodeTypes = {
  cartoSemanticFile: SemanticFileNode,
  cartoSemanticGroup: SemanticGroupNode,
};

export function SemanticGraphLens({
  repoPath,
  status,
  refreshKey,
  selectedNodeId,
  onSelectNode,
}: SemanticGraphLensProps) {
  const t = useT();

  const fetchKey = `${repoPath ?? ''}:${refreshKey}:${status?.state ?? ''}`;
  const shouldFetch = Boolean(repoPath && status?.state === 'ready');

  const [fetchState, setFetchState] = useState<GraphFetchState>({
    key: '',
    graph: null,
    error: null,
    loading: false,
  });

  const resetKey = `${repoPath ?? ''}:${refreshKey}`;
  const emptyPositions = useMemo(() => new Map<string, { x: number; y: number }>(), []);
  const [manualPositionsEntry, setManualPositionsEntry] = useState<{
    key: string;
    positions: Map<string, { x: number; y: number }>;
  }>({
    key: resetKey,
    positions: new Map(),
  });

  const manualPositions = manualPositionsEntry.key === resetKey ? manualPositionsEntry.positions : emptyPositions;

  const expandedRoles = useGitStore((s) => {
    const repo = s.getActiveRepo();
    return repo?.path === repoPath ? repo.cartographyExpandedRoles : [];
  });
  const updateRepoByPath = useGitStore((s) => s.updateRepoByPath);

  useEffect(() => {
    if (!repoPath || status?.state !== 'ready') return;

    let active = true;
    void window.api.cartoGraph
      .snapshot(repoPath)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          setFetchState({ key: fetchKey, graph: res.data, error: null, loading: false });
        } else {
          setFetchState({ key: fetchKey, graph: null, error: res.error ?? t('cartography.graph.error'), loading: false });
        }
      })
      .catch((err) => {
        if (!active) return;
        setFetchState({
          key: fetchKey,
          graph: null,
          error: err instanceof Error ? err.message : t('cartography.graph.error'),
          loading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [fetchKey, repoPath, status?.state, t]);

  const graph = shouldFetch && fetchState.key === fetchKey ? fetchState.graph : null;
  const loading = shouldFetch ? (fetchState.key === fetchKey ? fetchState.loading : true) : false;
  const error =
    status?.state === 'error'
      ? (status.error ?? t('cartography.graph.error'))
      : shouldFetch && fetchState.key === fetchKey
        ? fetchState.error
        : null;

  const expandedRoleSet = useMemo(() => new Set<CartoRoleId>(expandedRoles), [expandedRoles]);
  const model = useMemo(() => buildGraphModel(graph, t), [graph, t]);
  const toggleGroup = useCallback(
    (role: CartoRoleId) => {
      if (!repoPath) return;
      const current = useGitStore.getState().openRepos.find((repo) => repo.path === repoPath);
      const set = new Set<CartoRoleId>(current?.cartographyExpandedRoles ?? []);
      if (set.has(role)) set.delete(role);
      else set.add(role);
      updateRepoByPath(repoPath, { cartographyExpandedRoles: [...set] });
    },
    [repoPath, updateRepoByPath],
  );
  const flow = useMemo(
    () => buildFlow(graph, model, expandedRoleSet, manualPositions, selectedNodeId, toggleGroup, t),
    [graph, model, expandedRoleSet, manualPositions, selectedNodeId, toggleGroup, t],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<SemanticFlowNode>[]) => {
      setManualPositionsEntry((current) => {
        const base = current.key === resetKey ? current.positions : new Map<string, { x: number; y: number }>();
        let next: Map<string, { x: number; y: number }> | null = null;
        const ensureNext = () => {
          next ??= new Map(base);
          return next;
        };

        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            ensureNext().set(change.id, change.position);
          }
          if (change.type === 'remove') {
            ensureNext().delete(change.id);
          }
        }

        if (!next) return current;
        return { key: resetKey, positions: next };
      });
    },
    [resetKey],
  );

  if (!repoPath) {
    return <GraphHint icon={<Network size={18} />} text={t('cartography.emptyHint')} />;
  }
  if (status?.state === 'indexing' || status?.state === 'idle') {
    return (
      <GraphHint
        icon={<Loader2 size={18} className={styles.spinner} />}
        text={t('cartography.graph.indexing')}
      />
    );
  }
  if (status?.state === 'engine-unavailable') {
    return (
      <GraphHint
        icon={<AlertTriangle size={18} />}
        text={t('cartography.graph.engineUnavailable')}
        detail={t('cartography.graph.engineUnavailableHint')}
      />
    );
  }
  if (loading) {
    return (
      <GraphHint
        icon={<Loader2 size={18} className={styles.spinner} />}
        text={t('cartography.semantic.loading')}
      />
    );
  }
  if (error) {
    return <GraphHint icon={<AlertTriangle size={18} />} text={error} tone="error" />;
  }
  if (!graph || (graph.allNodes ?? graph.nodes).length === 0) {
    return <GraphHint icon={<Network size={18} />} text={t('cartography.semantic.empty')} />;
  }

  return (
    <div className={styles.canvasRoot}>
      <ReactFlow<SemanticFlowNode, FlowEdge>
        className="carto-semantic-flow"
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        nodesDraggable
        nodesConnectable={false}
        onNodesChange={handleNodesChange}
        onlyRenderVisibleElements
        snapToGrid
        snapGrid={[24, 24]}
        selectNodesOnDrag={false}
        nodeClickDistance={5}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.2}
        maxZoom={1.55}
        onNodeClick={(_event, node) => {
          if (node.data.kind === 'group') return;
          onSelectNode(node.data.cartoNode);
        }}
      >
        <Controls className="carto-semantic-controls" showInteractive={false} />
      </ReactFlow>

      <div className={styles.hudOverlay}>
        <div className={styles.hudPill}>
          <Layers3 size={13} className={styles.hudPillIcon} />
          <span className={styles.hudPillText}>
            {t('cartography.semantic.groupStats', {
              groups: model.groups.length,
              nodes: flow.nodes.filter((node) => node.data.kind === 'file').length,
              edges: flow.edges.length,
            })}
          </span>
        </div>
        <div className={styles.hudPillSecondary}>
          {expandedRoles.length > 0
            ? t('cartography.semantic.expandedGroups', { count: expandedRoles.length })
            : t('cartography.semantic.groupOverview')}
        </div>
        {graph.truncated || flow.edges.length >= MAX_FLOW_EDGES ? (
          <div className={styles.hudPillWarning}>
            {t('cartography.semantic.limited')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildGraphModel(graph: CartoGraph | null, t: ReturnType<typeof useT>): GraphModel {
  const nodeById = new Map<string, CartoNode>();
  const roleByNodeId = new Map<string, CartoRoleId>();
  const relationCount = new Map<string, number>();
  if (!graph) {
    return { nodeById, roleByNodeId, relationCount, groups: [], groupModel: { groups: [], groupEdges: [] } };
  }

  const groupModel = buildGroupModel(graph);
  const nodes = graph.allNodes ?? graph.nodes;
  for (const node of nodes) {
    nodeById.set(node.id, node);
    roleByNodeId.set(node.id, classifyCartoRole(node));
  }
  for (const edge of graph.edges) {
    relationCount.set(edge.fromId, (relationCount.get(edge.fromId) ?? 0) + 1);
    relationCount.set(edge.toId, (relationCount.get(edge.toId) ?? 0) + 1);
  }

  const grouped = new Map<CartoRoleId, CartoNode[]>();
  for (const role of CARTO_ROLE_DEFINITIONS) grouped.set(role.id, []);
  for (const node of nodes) grouped.get(roleByNodeId.get(node.id) ?? classifyCartoRole(node))?.push(node);

  const groupByRole = new Map(groupModel.groups.map((group) => [group.role, group]));
  const groups = CARTO_ROLE_DEFINITIONS
    .map((role) => {
      const group = groupByRole.get(role.id);
      const roleNodes = [...(grouped.get(role.id) ?? [])].sort((a, b) => {
        const byRelations = (relationCount.get(b.id) ?? 0) - (relationCount.get(a.id) ?? 0);
        return byRelations || a.filePath.localeCompare(b.filePath);
      });
      return {
        role,
        label: t(role.labelKey),
        nodes: roleNodes,
        keyFiles: group?.keyFiles ?? [],
        summary: group?.summary,
      };
    })
    .filter((group) => group.nodes.length > 0);

  return { nodeById, roleByNodeId, relationCount, groups, groupModel };
}

function buildFlow(
  graph: CartoGraph | null,
  model: GraphModel,
  expandedRoles: Set<CartoRoleId>,
  manualPositions: Map<string, { x: number; y: number }>,
  selectedNodeId: string | null,
  onToggleGroup: (role: CartoRoleId) => void,
  t: ReturnType<typeof useT>,
): { nodes: SemanticFlowNode[]; edges: FlowEdge[] } {
  if (!graph) return { nodes: [], edges: [] };

  const nodes: SemanticFlowNode[] = [];
  const visibleIds = new Set<string>();
  const visibleFileIds = new Set<string>();
  const groupPositions = buildGroupPositions(model.groups, expandedRoles);

  model.groups.forEach((group) => {
    const position = groupPositions.get(group.role.id) ?? { x: 0, y: 0 };
    const expanded = expandedRoles.has(group.role.id);
    const visibleGroupNodes = expanded ? group.nodes.slice(0, MAX_OVERVIEW_NODES_PER_ROLE) : [];
    const hiddenCount = expanded ? Math.max(0, group.nodes.length - visibleGroupNodes.length) : 0;
    const groupNodeIdValue = groupNodeId(group.role.id);
    visibleIds.add(groupNodeIdValue);
    nodes.push({
      id: groupNodeIdValue,
      type: 'cartoSemanticGroup',
      position: manualPositions.get(groupNodeIdValue) ?? position,
      zIndex: expanded ? 2 : 1,
      data: {
        kind: 'group',
        role: group.role,
        roleLabel: group.label,
        roleDescription: t(`cartography.panorama.roleDesc.${group.role.id}`),
        count: group.nodes.length,
        keyFiles: group.keyFiles,
        summary: group.summary,
        expanded,
        hiddenCount,
        actionLabel: expanded ? t('cartography.semantic.collapseGroup') : t('cartography.semantic.expandGroup'),
        moreLabel: t('cartography.semantic.moreFiles', { count: hiddenCount }),
        keyFilesLabel: t('cartography.panorama.keyFiles'),
        onToggleGroup,
      },
    });

    visibleGroupNodes.forEach((cartoNode, fileIndex) => {
      const role = CARTO_ROLE_BY_ID[model.roleByNodeId.get(cartoNode.id) ?? classifyCartoRole(cartoNode)];
      visibleIds.add(cartoNode.id);
      visibleFileIds.add(cartoNode.id);
      nodes.push({
        id: cartoNode.id,
        type: 'cartoSemanticFile',
        position: manualPositions.get(cartoNode.id) ?? expandedFilePosition(position, fileIndex),
        selected: cartoNode.id === selectedNodeId,
        zIndex: 3,
        data: {
          kind: 'file',
          cartoNode,
          role,
          roleLabel: t(role.labelKey),
          relationCount: model.relationCount.get(cartoNode.id) ?? 0,
        },
      });
    });
  });

  return {
    nodes,
    edges: buildVisibleEdges(graph, model, expandedRoles, visibleIds, visibleFileIds),
  };
}

function buildVisibleEdges(
  graph: CartoGraph,
  model: GraphModel,
  expandedRoles: Set<CartoRoleId>,
  visibleIds: Set<string>,
  visibleFileIds: Set<string>,
): FlowEdge[] {
  if (expandedRoles.size === 0) {
    return model.groupModel.groupEdges.map((edge) => groupFlowEdge(edge.from, edge.to, edge.weight));
  }

  const aggregate = new Map<string, { source: string; target: string; weight: number }>();
  for (const edge of graph.edges) {
    const from = model.nodeById.get(edge.fromId);
    const to = model.nodeById.get(edge.toId);
    if (!from || !to) continue;

    const source = endpointId(from, model, expandedRoles, visibleFileIds);
    const target = endpointId(to, model, expandedRoles, visibleFileIds);
    if (source === target || !visibleIds.has(source) || !visibleIds.has(target)) continue;

    const key = `${source}->${target}`;
    const current = aggregate.get(key) ?? { source, target, weight: 0 };
    current.weight += 1;
    aggregate.set(key, current);
  }

  return [...aggregate.values()]
    .sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .slice(0, MAX_FLOW_EDGES)
    .map((edge, index) => weightedFlowEdge(edge.source, edge.target, edge.weight, index));
}

function endpointId(
  node: CartoNode,
  model: GraphModel,
  expandedRoles: Set<CartoRoleId>,
  visibleFileIds: Set<string>,
): string {
  const role = model.roleByNodeId.get(node.id) ?? classifyCartoRole(node);
  if (expandedRoles.has(role) && visibleFileIds.has(node.id)) return node.id;
  return groupNodeId(role);
}

function groupFlowEdge(from: CartoRoleId, to: CartoRoleId, weight: number): FlowEdge {
  return weightedFlowEdge(groupNodeId(from), groupNodeId(to), weight, 0);
}

function weightedFlowEdge(source: string, target: string, weight: number, index: number): FlowEdge {
  return {
    id: `${source}-${target}-${index}`,
    source,
    target,
    type: 'smoothstep',
    label: String(weight),
    interactionWidth: 18,
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-carto-edge)' },
    style: {
      stroke: 'var(--color-carto-edge)',
      strokeWidth: Math.min(3.4, 1.15 + Math.log2(weight + 1) * 0.45),
      opacity: 0.84,
    },
    labelStyle: {
      fill: 'var(--color-carto-accent)',
      fontSize: 'var(--font-size-2xs)',
      fontWeight: 800,
    },
    labelBgStyle: {
      fill: 'color-mix(in srgb, var(--color-carto-canvas) 92%, transparent)',
      stroke: 'color-mix(in srgb, var(--color-warning) 24%, transparent)',
      strokeWidth: 1,
    },
    labelBgPadding: [4, 3],
    labelBgBorderRadius: 4,
  };
}

function groupNodeId(role: CartoRoleId): string {
  return `carto-group:${role}`;
}

function buildGroupPositions(
  groups: RoleGroup[],
  expandedRoles: Set<CartoRoleId>,
): Map<CartoRoleId, { x: number; y: number }> {
  const positions = new Map<CartoRoleId, { x: number; y: number }>();
  let y = 0;

  for (let rowStart = 0; rowStart < groups.length; rowStart += GROUP_COLS) {
    const row = groups.slice(rowStart, rowStart + GROUP_COLS);
    let rowHeight = GROUP_H;

    row.forEach((group) => {
      if (!expandedRoles.has(group.role.id)) return;
      const visibleCount = Math.min(group.nodes.length, MAX_OVERVIEW_NODES_PER_ROLE);
      if (visibleCount === 0) return;
      const fileRows = Math.ceil(visibleCount / 2);
      const expandedHeight =
        GROUP_H + GROUP_EXPANDED_GAP + fileRows * NODE_H + Math.max(0, fileRows - 1) * NODE_Y_GAP;
      rowHeight = Math.max(rowHeight, expandedHeight);
    });

    row.forEach((group, columnIndex) => {
      const index = rowStart + columnIndex;
      positions.set(group.role.id, {
        x: columnIndex * GROUP_X + jitter(`group-${index}`, 1),
        y: y + jitter(`group-${index}`, 2),
      });
    });

    y += rowHeight + GROUP_ROW_GAP;
  }

  return positions;
}

function expandedFilePosition(group: { x: number; y: number }, index: number): { x: number; y: number } {
  const cols = 2;
  return {
    x: group.x + (index % cols) * (NODE_W + NODE_X_GAP) + 3,
    y: group.y + GROUP_H + GROUP_EXPANDED_GAP + Math.floor(index / cols) * (NODE_H + NODE_Y_GAP),
  };
}

function SemanticGroupNode({ data }: NodeProps<SemanticGroupFlowNode>) {
  return (
    <div
      className={cn('carto-semantic-group', styles.groupCard, data.expanded && 'is-expanded')}
      style={{ '--carto-role-color': data.role.color } as CSSProperties}
      title={data.actionLabel}
      data-testid={`carto-group-${data.role.id}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className={styles.groupHeader}>
        <span className="carto-semantic-node__icon">
          <Layers3 size={15} />
        </span>
        <div className={styles.groupTitleWrapper}>
          <div className={styles.groupTitleRow}>
            <p className={styles.groupTitle}>{data.roleLabel}</p>
            <span className="carto-semantic-node__count">{data.count}</span>
          </div>
          <p className={styles.groupDescription}>
            {data.summary ?? data.roleDescription}
          </p>
        </div>
      </div>

      <div className={styles.groupKeyFiles}>
        <p className={styles.keyFilesTitle}>{data.keyFilesLabel}</p>
        <ul className={styles.keyFilesList}>
          {data.keyFiles.slice(0, 3).map((file) => (
            <li key={file.node.id} className={styles.keyFileItem}>
              <span className={styles.keyFileDot} style={{ background: data.role.color }} />
              <span className={styles.keyFilePath}>{file.node.filePath}</span>
              <span className={styles.keyFileDegree}>{file.degree}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.groupFooter}>
        <button
          type="button"
          className={cn('nodrag nopan', styles.expandButton)}
          title={data.actionLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleGroup(data.role.id);
          }}
        >
          {data.expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {data.actionLabel}
        </button>
        {data.expanded && data.hiddenCount > 0 ? (
          <span className={cn('nodrag nopan', styles.hiddenCount)} title={data.moreLabel}>
            {data.moreLabel}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function SemanticFileNode({ data, selected }: NodeProps<SemanticFileFlowNode>) {
  const node = data.cartoNode;
  const file = node.filePath.split('/').at(-1) ?? node.name;
  const dir = node.filePath.includes('/') ? node.filePath.split('/').slice(0, -1).join('/') : '.';

  return (
    <div
      className={cn('carto-semantic-node', styles.fileCard, selected && 'is-selected')}
      style={{ '--carto-role-color': data.role.color } as CSSProperties}
      title={node.filePath}
      data-testid={`carto-file-${node.id}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className={styles.fileHeader}>
        <span className="carto-semantic-node__icon">
          <FileCode size={14} />
        </span>
        <div className={styles.fileTitleWrapper}>
          <p className={styles.fileName}>{file}</p>
          <p className={styles.fileDir}>{dir}</p>
        </div>
        <span className="carto-semantic-node__count">{data.relationCount}</span>
      </div>
      <p className={styles.fileRole}>
        {data.roleLabel}
      </p>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function GraphHint({
  icon,
  text,
  detail,
  tone = 'muted',
}: {
  icon: ReactNode;
  text: string;
  detail?: string;
  tone?: 'muted' | 'error';
}) {
  return (
    <div className={cn(styles.hintContainer, tone === 'error' && styles.hintError)}>
      {icon}
      <p className={styles.hintMessage}>{text}</p>
      {detail && <p className={styles.hintDetail}>{detail}</p>}
    </div>
  );
}

function jitter(input: string, salt: number): number {
  let h = salt * 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 38) - 19;
}
