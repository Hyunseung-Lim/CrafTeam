import { useState, useEffect, useRef } from "react";
import {
  TeamMemberSlot,
  Relationship,
  RelationshipType,
  RELATIONSHIP_TYPES,
  AIAgent,
} from "@/lib/types";
import { getMemberDisplayName } from "@/lib/member-utils";
import { createTeamIdManager } from "@/lib/id-manager";
import { Button } from "@/components/ui/button";
import { Plus, User, XIcon } from "lucide-react";

// RelationshipGraph 컴포넌트
export function RelationshipGraph({
  members,
  relationships,
  onAddRelationship,
  onRemoveRelationship,
  readOnly = false,
  initialNodePositions = {},
  onNodePositionChange,
  agents = [],
}: {
  members: TeamMemberSlot[];
  relationships: Relationship[];
  onAddRelationship: (from: string, to: string, type: RelationshipType) => void;
  onRemoveRelationship: (from: string, to: string) => void;
  readOnly?: boolean;
  initialNodePositions?: { [key: string]: { x: number; y: number } };
  onNodePositionChange?: (positions: { [key: string]: { x: number; y: number } }) => void;
  agents?: AIAgent[];
}) {
  const [nodes, setNodes] = useState<{
    [key: string]: { x: number; y: number };
  }>({});
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [connectionCandidate, setConnectionCandidate] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 노드 위치 초기화 (저장된 위치 우선, 없으면 원형 배치)
  useEffect(() => {
    if (!svgRef.current) return;
    const { width, height } = svgRef.current.getBoundingClientRect();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;
    const angleStep = (2 * Math.PI) / members.length;

    const newNodes: { [key: string]: { x: number; y: number } } = {};
    members.forEach((member, index) => {
      // 저장된 위치가 있으면 사용, 없으면 원형 배치
      if (initialNodePositions[member.id]) {
        newNodes[member.id] = initialNodePositions[member.id];
      } else {
        const angle = index * angleStep - Math.PI / 2;
        newNodes[member.id] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      }
    });
    setNodes(newNodes);
  }, [members, initialNodePositions]);

  const getRelativeMousePos = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleNodeClick = (nodeId: string) => {
    if (readOnly || !isConnecting) return;

    if (!connectingFrom) {
      setConnectingFrom(nodeId);
    } else if (connectingFrom !== nodeId) {
      // 멤버 슬롯 ID를 실제 저장된 ID로 변환해서 관계 확인
      const fromMember = members.find((m) => m.id === connectingFrom);
      const toMember = members.find((m) => m.id === nodeId);

      const fromId = fromMember?.isUser ? "Me" : fromMember?.agentId || connectingFrom;
      const toId = toMember?.isUser ? "Me" : toMember?.agentId || nodeId;

      // 이미 관계가 있는지 확인 (양방향)
      const existing = relationships.find(
        (r) =>
          (r.from === fromId && r.to === toId) ||
          (r.from === toId && r.to === fromId)
      );
      if (existing) {
        // 이미 관계가 있으면 취소
        cancelConnecting();
        return;
      }
      setConnectionCandidate({ from: connectingFrom, to: nodeId });
      setIsConnecting(false);
      setConnectingFrom(null);
    }
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (readOnly || isConnecting) return;
    const pos = getRelativeMousePos(e);
    setDragOffset({
      x: pos.x - nodes[nodeId].x,
      y: pos.y - nodes[nodeId].y,
    });
    setDraggedNode(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getRelativeMousePos(e);
    if (draggedNode) {
      setNodes((prev) => ({
        ...prev,
        [draggedNode]: {
          x: pos.x - dragOffset.x,
          y: pos.y - dragOffset.y,
        },
      }));
    } else if (isConnecting && connectingFrom) {
      setMousePosition(pos);
    }
  };

  const handleMouseUp = () => {
    // 드래그가 끝나면 위치 변경을 부모에게 알림
    if (draggedNode && onNodePositionChange) {
      onNodePositionChange(nodes);
    }
    // 클릭과 드래그를 구분하기 위해 약간의 딜레이 후 초기화
    setTimeout(() => setDraggedNode(null), 50);
  };

  const startConnecting = () => {
    setIsConnecting(true);
    setConnectionCandidate(null);
    setConnectingFrom(null);
  };

  const cancelConnecting = () => {
    setIsConnecting(false);
    setConnectingFrom(null);
    setMousePosition(null);
    setConnectionCandidate(null);
  };

  const handleAddRelation = (type: RelationshipType) => {
    if (connectionCandidate) {
      onAddRelationship(connectionCandidate.from, connectionCandidate.to, type);
      cancelConnecting();
    }
  };

  return (
    <div className="relative">
      {/* 사용법 안내 */}
      {!readOnly && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">📋 Relationship Setting Guide</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p>• <strong>Peer Relationship:</strong> A reciprocal relationship where feedback and requests are possible</p>
            <p>• <strong>Superior-Subordinate Relationship:</strong> The direction of the arrow matters</p>
            <div className="ml-4 space-y-1 text-xs">
              <p>→ The person the arrow points to <span className="font-semibold text-blue-900">is the subordinate</span></p>
              <p>→ The person where the arrow starts <span className="font-semibold text-blue-900">is the superior</span></p>
              <p>→ Example: A → B (A is superior, B is subordinate)</p>
            </div>
          </div>
        </div>
      )}
      
      {!readOnly && (
        <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-lg items-center justify-between">
          <div>
            {!isConnecting && !connectionCandidate && (
              <Button variant="outline" onClick={startConnecting}>
                <Plus className="h-4 w-4 mr-2" />
                Connect Relationships
              </Button>
            )}
            {(isConnecting || connectionCandidate) && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-blue-700 bg-blue-100 px-3 py-2 rounded-md">
                {connectionCandidate
                  ? "What type of relationship?"
                  : connectingFrom
                  ? `${(() => {
                      const member = members.find(
                        (m) => m.id === connectingFrom
                      );
                      if (!member) return "Unknown";
                      return member.isUser
                        ? "Me"
                        : getMemberDisplayName(member, agents);
                    })()}, select a team member to connect.`
                  : "Select a team member to start the relationship."}
              </p>
              <Button variant="ghost" size="sm" onClick={cancelConnecting}>
                Cancel
              </Button>
            </div>
            )}
          </div>

          {connectionCandidate && (
            <div className="flex gap-2">
              {Object.entries(RELATIONSHIP_TYPES)
                .filter(([, config]) => !config.hidden) // Filter out hidden relationships
                .map(([type, config]) => (
                <Button
                  key={type}
                  size="sm"
                  onClick={() => handleAddRelation(type as RelationshipType)}
                  variant="outline"
                  className="text-xs"
                >
                  {config.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        height="500"
        className="border border-gray-200 rounded-lg bg-white cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDraggedNode(null)}
      >
        <defs>
          <marker
            id="arrow-SUPERVISOR"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={RELATIONSHIP_TYPES.SUPERVISOR.color}
            />
          </marker>
        </defs>

        {/* 관계 엣지 */}
        {relationships.filter(rel => rel.type !== "NULL").map((rel, index) => {
          // ID 매니저를 사용한 안정적인 멤버 찾기
          const fakeTeam: import("@/lib/types").Team = {
            id: 'temp',
            ownerId: 'temp',
            teamName: 'temp',
            createdAt: new Date(),
            members: members.map(m => ({
              agentId: m.isUser ? null : (m.agentId || m.id),
              roles: m.roles,
              isUser: m.isUser,
              userProfile: m.isUser ? {
                name: "Me",
                skills: "",
                personality: "",
                workStyle: "",
                preferences: "",
                dislikes: ""
              } : undefined
            })),
            relationships
          };
          const idManager = createTeamIdManager(fakeTeam);

          // 저장된 관계 ID를 슬롯 ID로 역변환해서 멤버 찾기
          const fromMember = members.find(m => {
            if (m.isUser) {
              return rel.from === "Me";
            } else {
              return m.id === rel.from || m.agentId === rel.from ||
                     idManager.isSameMember(m.id || '', rel.from) ||
                     idManager.isSameMember(m.agentId || '', rel.from);
            }
          });

          const toMember = members.find(m => {
            if (m.isUser) {
              return rel.to === "Me";
            } else {
              return m.id === rel.to || m.agentId === rel.to ||
                     idManager.isSameMember(m.id || '', rel.to) ||
                     idManager.isSameMember(m.agentId || '', rel.to);
            }
          });

          if (!fromMember || !toMember) return null;

          const fromNode = nodes[fromMember.id];
          const toNode = nodes[toMember.id];

          if (!fromNode || !toNode) return null;
          
          // Safety check for valid coordinates
          if (isNaN(fromNode.x) || isNaN(fromNode.y) || isNaN(toNode.x) || isNaN(toNode.y)) {
            return null;
          }

          const relType = RELATIONSHIP_TYPES[rel.type];
          const dx = toNode.x - fromNode.x;
          const dy = toNode.y - fromNode.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          
          // Prevent division by zero
          if (length === 0) return null;
          
          const unitX = dx / length;
          const unitY = dy / length;

          const nodeRadius = 35;
          const startX = fromNode.x + unitX * nodeRadius;
          const startY = fromNode.y + unitY * nodeRadius;

          const isSupervisor = rel.type === "SUPERVISOR";
          const endOffset = isSupervisor ? nodeRadius + 2 : nodeRadius;
          const endX = toNode.x - unitX * endOffset;
          const endY = toNode.y - unitY * endOffset;
          
          // Final safety check for calculated coordinates
          if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY)) {
            return null;
          }

          return (
            <g key={index} className="group">
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke="transparent"
                strokeWidth="20"
                className="cursor-pointer"
                onClick={() => onRemoveRelationship(rel.from, rel.to)}
              />
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={relType.color}
                strokeWidth={relType.strokeWidth || 2}
                strokeDasharray={relType.strokeDasharray}
                markerEnd={isSupervisor ? `url(#arrow-SUPERVISOR)` : undefined}
                className="transition-all pointer-events-none"
              />
              <text
                x={(startX + endX) / 2}
                y={(startY + endY) / 2 - 8}
                fill={relType.color}
                fontSize="12"
                textAnchor="middle"
                className="pointer-events-none font-medium"
              >
                {relType.label}
              </text>
              {/* 관계 제거 버튼 */}
              {!readOnly && (
                <g
                  className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onRemoveRelationship(rel.from, rel.to)}
                >
                <rect
                  x={(startX + endX) / 2 - 12}
                  y={(startY + endY) / 2 - 12}
                  width="24"
                  height="24"
                  rx="12"
                  fill="#fee2e2" // red-100
                  className="group-hover:fill-red-200 transition-colors"
                />
                <foreignObject
                  x={(startX + endX) / 2 - 8}
                  y={(startY + endY) / 2 - 8}
                  width="16"
                  height="16"
                >
                  <XIcon className="h-4 w-4 text-red-600" />
                </foreignObject>
                </g>
              )}
            </g>
          );
        })}

        {/* 연결 중인 임시 라인 */}
        {isConnecting && connectingFrom && mousePosition && (
          <line
            x1={nodes[connectingFrom]?.x || 0}
            y1={nodes[connectingFrom]?.y || 0}
            x2={mousePosition.x}
            y2={mousePosition.y}
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="4,4"
            className="pointer-events-none"
          />
        )}

        {/* Team member nodes */}
        {members.map((member) => {
          const node = nodes[member.id];
          if (!node) return null;

          const isBeingDragged = draggedNode === member.id;
          const isConnectStart = connectingFrom === member.id;

          return (
            <g
              key={member.id}
              transform={`translate(${node.x}, ${node.y})`}
              className={`group transition-transform duration-100 ${
                isBeingDragged ? "scale-105" : ""
              }`}
              onMouseDown={(e) => handleNodeMouseDown(e, member.id)}
              onClick={() => handleNodeClick(member.id)}
              cursor={isConnecting ? "pointer" : "grab"}
            >
              <circle
                r="32"
                fill="white"
                strokeWidth="2"
                stroke={
                  isConnectStart
                    ? "#2563eb" // blue-600
                    : isConnecting
                    ? "#9ca3af" // gray-400
                    : "#e5e7eb" // gray-200
                }
                className="transition-all"
              />
              <circle
                r="28"
                fill={
                  member.isUser
                    ? "#00C850" // green for users
                    : "#2B7FFF" // blue for agents
                }
                strokeWidth="1.5"
                stroke={
                  member.isUser
                    ? "#00C850" // green for users
                    : "#2B7FFF" // blue for agents
                }
              />
              <g pointerEvents="none" transform="translate(-12, -12)">
                <foreignObject x="4" y="4" width="16" height="16">
                  {member.isUser ? (
                    <User className="h-4 w-4 text-white" />
                  ) : (
                    <User className="h-4 w-4 text-white" />
                  )}
                </foreignObject>
              </g>

              <text
                y={45}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                className="pointer-events-none select-none fill-gray-700"
              >
                {getMemberDisplayName(member, agents)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
