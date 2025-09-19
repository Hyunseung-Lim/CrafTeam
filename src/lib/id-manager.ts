/**
 * CrafTeam 관계 시스템을 위한 중앙집중식 ID 관리 서비스
 *
 * 이 모듈은 다양한 형태의 ID(슬롯 ID, 에이전트 ID, 사용자 ID)를
 * 표준화된 형태로 변환하고 관리합니다.
 */

import { Team, TeamMember, AIAgent } from "@/lib/types";

export interface IdMapping {
  standardId: string;
  displayName: string;
  slotId?: string;
  agentId?: string;
  isUser: boolean;
}

export class TeamIdManager {
  private team: Team;
  private idMappings: Map<string, IdMapping>;
  private reverseMapping: Map<string, string[]>;

  constructor(team: Team) {
    this.team = team;
    this.idMappings = new Map();
    this.reverseMapping = new Map();
    this.buildMappings();
  }

  /**
   * 모든 가능한 ID 형태에 대한 매핑을 구성합니다.
   */
  private buildMappings(): void {
    const aiMembers = this.team.members.filter(m => !m.isUser);
    const letters = ["A", "B", "C", "D", "E", "F"];

    this.team.members.forEach((member, index) => {
      if (member.isUser) {
        // 사용자 ID 매핑
        const standardId = "Me";
        const mapping: IdMapping = {
          standardId,
          displayName: member.userProfile?.name || "Me",
          isUser: true,
        };

        // 사용자를 위한 모든 가능한 ID 매핑
        this.addMapping("Me", mapping);
        this.addMapping("나", mapping); // 레거시 호환성

        if (member.userProfile?.name) {
          this.addMapping(member.userProfile.name, mapping);
        }
      } else {
        // AI 에이전트 ID 매핑
        const standardId = member.agentId || `temp_member_${index}`;
        const aiMemberIndex = aiMembers.indexOf(member);
        const slotId = aiMemberIndex >= 0 ? letters[aiMemberIndex] : undefined;

        const mapping: IdMapping = {
          standardId,
          displayName: this.getAgentDisplayName(member),
          slotId,
          agentId: member.agentId || undefined,
          isUser: false,
        };

        // AI 에이전트를 위한 모든 가능한 ID 매핑
        this.addMapping(standardId, mapping); // 표준 ID (agentId)

        if (member.agentId) {
          this.addMapping(member.agentId, mapping);
        }

        if (slotId) {
          this.addMapping(slotId, mapping); // 슬롯 ID (A, B, C, D)
        }

        // 에이전트 이름으로도 매핑 (중복 방지)
        const displayName = this.getAgentDisplayName(member);
        if (displayName && displayName !== standardId) {
          this.addMapping(displayName, mapping);
        }
      }
    });
  }

  /**
   * ID 매핑을 추가하고 역방향 매핑도 구성합니다.
   */
  private addMapping(id: string, mapping: IdMapping): void {
    this.idMappings.set(id, mapping);

    // 역방향 매핑 구성 (표준 ID → 모든 별칭들)
    if (!this.reverseMapping.has(mapping.standardId)) {
      this.reverseMapping.set(mapping.standardId, []);
    }
    this.reverseMapping.get(mapping.standardId)!.push(id);
  }

  /**
   * 에이전트의 표시 이름을 안전하게 가져옵니다.
   */
  private getAgentDisplayName(member: TeamMember): string {
    // AgentId가 있으면 실제 에이전트 이름을 찾아서 반환
    // 없으면 임시 이름 사용
    return `Agent ${member.agentId || 'Unknown'}`;
  }

  /**
   * 임의의 ID를 표준 ID로 변환합니다.
   *
   * @param id - 변환할 ID (슬롯 ID, 에이전트 ID, 사용자 ID 등)
   * @returns 표준 ID 또는 null (찾을 수 없는 경우)
   */
  public normalizeId(id: string): string | null {
    if (!id) return null;

    const mapping = this.idMappings.get(id);
    return mapping ? mapping.standardId : null;
  }

  /**
   * 표준 ID를 표시용 이름으로 변환합니다.
   *
   * @param standardId - 표준 ID
   * @returns 표시용 이름
   */
  public getDisplayName(standardId: string): string {
    const mapping = this.idMappings.get(standardId);
    return mapping ? mapping.displayName : standardId;
  }

  /**
   * 표준 ID를 특정 형태의 ID로 변환합니다.
   *
   * @param standardId - 표준 ID
   * @param targetType - 목표 ID 타입
   * @returns 변환된 ID 또는 표준 ID
   */
  public getIdAs(standardId: string, targetType: 'slot' | 'agent' | 'display'): string {
    const mapping = this.idMappings.get(standardId);
    if (!mapping) return standardId;

    switch (targetType) {
      case 'slot':
        return mapping.slotId || standardId;
      case 'agent':
        return mapping.agentId || standardId;
      case 'display':
        return mapping.displayName;
      default:
        return standardId;
    }
  }

  /**
   * 멤버가 사용자인지 확인합니다.
   *
   * @param id - 확인할 ID
   * @returns 사용자 여부
   */
  public isUser(id: string): boolean {
    const mapping = this.idMappings.get(id);
    return mapping ? mapping.isUser : false;
  }

  /**
   * 두 ID가 같은 멤버를 가리키는지 확인합니다.
   *
   * @param id1 - 첫 번째 ID
   * @param id2 - 두 번째 ID
   * @returns 같은 멤버 여부
   */
  public isSameMember(id1: string, id2: string): boolean {
    const standardId1 = this.normalizeId(id1);
    const standardId2 = this.normalizeId(id2);
    return standardId1 !== null && standardId1 === standardId2;
  }

  /**
   * 표준 ID로 정규화된 관계 배열을 반환합니다.
   *
   * @param relationships - 원본 관계 배열
   * @returns 정규화된 관계 배열
   */
  public normalizeRelationships(relationships: any[]): Array<{from: string, to: string, type: string}> {
    return relationships
      .map(rel => {
        const normalizedFrom = this.normalizeId(rel.from);
        const normalizedTo = this.normalizeId(rel.to);

        return {
          from: normalizedFrom,
          to: normalizedTo,
          type: rel.type,
        };
      })
      .filter(rel => rel.from !== null && rel.to !== null) // null 값 제거
      .map(rel => ({
        from: rel.from!,
        to: rel.to!,
        type: rel.type,
      }));
  }

  /**
   * 특정 멤버의 모든 별칭을 반환합니다.
   *
   * @param id - 기준 ID
   * @returns 모든 별칭 배열
   */
  public getAllAliases(id: string): string[] {
    const standardId = this.normalizeId(id);
    if (!standardId) return [];

    return this.reverseMapping.get(standardId) || [];
  }

  /**
   * 전체 ID 매핑 정보를 반환합니다. (디버깅용)
   */
  public getDebugInfo(): { mappings: Array<{id: string, mapping: IdMapping}> } {
    const mappings = Array.from(this.idMappings.entries()).map(([id, mapping]) => ({
      id,
      mapping,
    }));

    return { mappings };
  }
}

/**
 * 팀 인스턴스로부터 TeamIdManager를 생성합니다.
 *
 * @param team - 팀 객체
 * @returns TeamIdManager 인스턴스
 */
export function createTeamIdManager(team: Team): TeamIdManager {
  return new TeamIdManager(team);
}

/**
 * 레거시 호환성을 위한 유틸리티 함수들
 */
export const LegacyCompat = {
  /**
   * 기존 createMemberIdMapping 함수와 호환되는 형태로 매핑을 반환합니다.
   */
  createLegacyIdMapping(team: Team): { [slotId: string]: string } {
    const manager = new TeamIdManager(team);
    const legacyMapping: { [slotId: string]: string } = {};

    team.members.forEach(member => {
      if (member.isUser) {
        legacyMapping["Me"] = "Me";
        legacyMapping["나"] = "Me";
      } else {
        const standardId = manager.normalizeId(member.agentId || '');
        if (standardId) {
          const slotId = manager.getIdAs(standardId, 'slot');
          if (slotId !== standardId) {
            legacyMapping[slotId] = standardId;
          }
          if (member.agentId && member.agentId !== standardId) {
            legacyMapping[member.agentId] = standardId;
          }
        }
      }
    });

    return legacyMapping;
  }
};