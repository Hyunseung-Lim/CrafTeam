import { Team, RelationshipType } from "@/lib/types";
import { findMemberById, getMemberActualId } from "@/lib/member-utils";
import { createTeamIdManager } from "@/lib/id-manager";

/**
 * 두 팀원 간의 관계 타입을 조회합니다.
 * 새로운 ID 매니저를 사용하여 더 안정적이고 효율적인 조회를 제공합니다.
 */
export function getRelationshipType(
  fromId: string,
  toId: string,
  team: Team
): RelationshipType | null {
  const idManager = createTeamIdManager(team);

  // ID 정규화 (더 안정적인 방법)
  const normalizedFromId = idManager.normalizeId(fromId);
  const normalizedToId = idManager.normalizeId(toId);


  if (!normalizedFromId || !normalizedToId) {
    console.log(`❌ ID 정규화 실패: fromId=${fromId}, toId=${toId}`);
    return null;
  }

  // 자기 자신과의 관계는 없음
  if (normalizedFromId === normalizedToId) {
    return null;
  }

  // 직접 관계 찾기 (표준화된 ID로 검색)
  const directRelationship = team.relationships.find(
    (rel) => {
      const relFromId = idManager.normalizeId(rel.from);
      const relToId = idManager.normalizeId(rel.to);

      console.log(`🔍 관계 확인: ${rel.from}(${relFromId}) → ${rel.to}(${relToId}) [${rel.type}]`);
      return (relFromId === normalizedFromId && relToId === normalizedToId);
    }
  );

  if (directRelationship) {
    console.log(`✅ 직접 관계 발견: ${directRelationship.type}`);
    return directRelationship.type;
  }

  // 역방향 관계 찾기 (상사-부하 관계의 경우)
  const reverseRelationship = team.relationships.find(
    (rel) => {
      const relFromId = idManager.normalizeId(rel.from);
      const relToId = idManager.normalizeId(rel.to);

      return (relFromId === normalizedToId && relToId === normalizedFromId);
    }
  );

  if (reverseRelationship) {
    // 상사-부하 관계의 경우 역방향에서는 부하가 상사에게 요청하는 것
    if (reverseRelationship.type === "SUPERVISOR") {
      return "SUBORDINATE"; // 역방향에서는 SUBORDINATE로 표시
    }

    // 동료 관계는 양방향으로 동일
    if (reverseRelationship.type === "PEER") {
      return "PEER";
    }

    // 다른 관계 유형들도 역방향으로 처리
    return reverseRelationship.type;
  }

  // 관계가 없는 경우
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
  // 사용자("Me")는 모든 에이전트와 피드백 세션 생성 가능
  if (fromId === "Me") {
    return true;
  }

  const relationshipType = getRelationshipType(fromId, toId, team);

  // 명시적 관계가 있는 경우 확인
  if (relationshipType) {
    // 상사-부하 관계(양방향), 동료 관계는 피드백 세션 생성 가능
    return relationshipType === "SUPERVISOR" || relationshipType === "SUBORDINATE" || relationshipType === "PEER";
  }

  // 명시적 관계가 없는 경우: 사용자(Me)에게는 항상 피드백 가능, 다른 에이전트는 불허용
  const toMember = findMemberById(team, toId);
  if (toMember && toMember.isUser) {
    return true;
  }

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
  // 사용자("Me")는 모든 에이전트에게 요청 가능
  if (fromId === "Me") {
    console.log(`🔍 요청 가능: 사용자는 모든 에이전트에게 요청 허용`);
    return true;
  }

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

