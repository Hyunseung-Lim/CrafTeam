import { Team, RelationshipType } from "@/lib/types";
import { findMemberById, getMemberActualId } from "@/lib/member-utils";

/**
 * 두 팀원 간의 관계 타입을 조회합니다.
 */
export function getRelationshipType(
  fromId: string,
  toId: string,
  team: Team
): RelationshipType | null {
  // 멤버 ID 정규화 (중앙화된 유틸리티 사용)
  const fromMember = findMemberById(team, fromId);
  const toMember = findMemberById(team, toId);
  
  console.log(`🔍 관계 타입 조회: ${fromId} → ${toId}`);
  console.log(`🔍 fromMember:`, fromMember ? {isUser: fromMember.isUser, agentId: fromMember.agentId} : 'null');
  console.log(`🔍 toMember:`, toMember ? {isUser: toMember.isUser, agentId: toMember.agentId} : 'null');
  
  if (!fromMember || !toMember) {
    console.log(`🔍 멤버를 찾을 수 없음: from=${!!fromMember}, to=${!!toMember}`);
    return null;
  }
  
  const normalizedFromId = getMemberActualId(fromMember);
  const normalizedToId = getMemberActualId(toMember);

  // Legacy support: handle both "나" and "Me" for user identification
  const legacyNormalizedFromId = (normalizedFromId === "Me" || normalizedFromId === "나") ? ["Me", "나"] : [normalizedFromId];
  const legacyNormalizedToId = (normalizedToId === "Me" || normalizedToId === "나") ? ["Me", "나"] : [normalizedToId];

  console.log(`🔍 정규화된 ID: ${normalizedFromId} → ${normalizedToId}`);
  console.log(`🔍 레거시 호환 ID: [${legacyNormalizedFromId.join(", ")}] → [${legacyNormalizedToId.join(", ")}]`);

  // 자기 자신과의 관계는 없음
  if (normalizedFromId === normalizedToId) {
    console.log(`🔍 자기 자신과의 관계: 무시`);
    return null;
  }

  // 직접 관계 찾기 (legacy support 포함)
  const directRelationship = team.relationships.find(
    (rel) =>
      legacyNormalizedFromId.includes(rel.from) && legacyNormalizedToId.includes(rel.to)
  );

  console.log(`🔍 직접 관계:`, directRelationship || 'null');

  if (directRelationship) {
    console.log(`🔍 직접 관계 발견: ${directRelationship.type}`);
    return directRelationship.type;
  }

  // 역방향 관계 찾기 (상사-부하 관계의 경우, legacy support 포함)
  const reverseRelationship = team.relationships.find(
    (rel) =>
      legacyNormalizedToId.includes(rel.from) && legacyNormalizedFromId.includes(rel.to)
  );

  console.log(`🔍 역방향 관계:`, reverseRelationship || 'null');

  if (reverseRelationship) {
    // 상사-부하 관계의 경우 역방향에서는 부하가 상사에게 요청하는 것
    if (reverseRelationship.type === "SUPERVISOR") {
      console.log(`🔍 역방향 상사-부하 관계: SUBORDINATE 반환`);
      return "SUBORDINATE"; // 역방향에서는 SUBORDINATE로 표시
    }
    
    // 동료 관계는 양방향으로 동일
    if (reverseRelationship.type === "PEER") {
      console.log(`🔍 역방향 동료 관계: PEER 반환`);
      return "PEER";
    }
    
    // 다른 관계 유형들도 역방향으로 처리
    console.log(`🔍 기타 역방향 관계: ${reverseRelationship.type} 반환`);
    return reverseRelationship.type;
  }

  // 관계가 없는 경우
  console.log(`🔍 관계 없음: null 반환`);
  return null;
}

/**
 * 피드백 세션을 생성할 권한이 있는지 확인합니다.
 */
export function canCreateFeedbackSession(
  fromId: string,
  toId: string,
  team: Team
): boolean {
  const relationshipType = getRelationshipType(fromId, toId, team);
  
  console.log(`🔍 피드백 관계 확인: ${fromId} → ${toId}, 관계 타입: ${relationshipType}`);
  
  // 명시적 관계가 있는 경우 확인
  if (relationshipType) {
    // 상사-부하 관계(양방향), 동료 관계는 피드백 세션 생성 가능
    const canCreate = relationshipType === "SUPERVISOR" || relationshipType === "SUBORDINATE" || relationshipType === "PEER";
    console.log(`🔍 피드백 가능 여부: ${canCreate} (타입: ${relationshipType})`);
    return canCreate;
  }

  // 명시적 관계가 없는 경우: 사용자(Me)에게는 항상 피드백 가능, 다른 에이전트는 불허용
  const toMember = findMemberById(team, toId);
  if (toMember && toMember.isUser) {
    console.log(`🔍 피드백 가능: 사용자에게는 항상 피드백 허용`);
    return true;
  }

  console.log(`🔍 피드백 불가: 관계 없음 (에이전트 간)`);
  return false;
}

/**
 * 아이디어를 평가할 권한이 있는지 확인합니다.
 */
export function canEvaluateIdea(
  evaluatorId: string,
  ideaAuthorId: string,
  team: Team
): boolean {
  // 자기 자신의 아이디어는 평가할 수 없음
  if (evaluatorId === ideaAuthorId) {
    return false;
  }

  // 아이디어 평가는 관계와 상관없이 모든 팀원이 가능하도록 변경
  // (자기 자신 제외)
  return true;
}

/**
 * 요청을 보낼 권한이 있는지 확인합니다.
 */
export function canMakeRequest(
  fromId: string,
  toId: string,
  team: Team
): boolean {
  const relationshipType = getRelationshipType(fromId, toId, team);
  
  console.log(`🔍 요청 관계 확인: ${fromId} → ${toId}, 관계 타입: ${relationshipType}`);
  
  // 명시적 관계가 있는 경우 확인
  if (relationshipType) {
    // 상사-부하 관계(양방향), 동료 관계는 요청 가능
    const canRequest = relationshipType === "SUPERVISOR" || relationshipType === "SUBORDINATE" || relationshipType === "PEER";
    console.log(`🔍 요청 가능 여부: ${canRequest} (타입: ${relationshipType})`);
    return canRequest;
  }

  // 명시적 관계가 없는 경우: 사용자(Me)에게는 항상 요청 가능, 다른 에이전트는 불허용
  const toMember = findMemberById(team, toId);
  if (toMember && toMember.isUser) {
    console.log(`🔍 요청 가능: 사용자에게는 항상 요청 허용`);
    return true;
  }

  console.log(`🔍 요청 불가: 관계 없음 (에이전트 간)`);
  return false;
}

