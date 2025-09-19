/**
 * CrafTeam을 위한 타입 안전 JSON 파싱 유틸리티
 *
 * Redis에서 가져온 데이터의 안전한 파싱과 검증을 담당합니다.
 */

import { z } from "zod";
import { Relationship, RelationshipType } from "@/lib/types";

// Zod 스키마 정의
const RelationshipTypeSchema = z.enum(['PEER', 'SUPERVISOR', 'SUBORDINATE', 'NULL']);

const RelationshipSchema = z.object({
  from: z.string().min(1, "from ID cannot be empty"),
  to: z.string().min(1, "to ID cannot be empty"),
  type: RelationshipTypeSchema,
});

const NodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const NodePositionsSchema = z.record(z.string(), NodePositionSchema);

export interface ParseResult<T> {
  success: boolean;
  data: T;
  errors?: string[];
  warnings?: string[];
}

/**
 * 관계 데이터를 안전하게 파싱합니다.
 *
 * @param data - 파싱할 데이터 (문자열, 배열, 또는 기타)
 * @returns 파싱 결과
 */
export function safeParseRelationships(data: unknown): ParseResult<Relationship[]> {
  const result: ParseResult<Relationship[]> = {
    success: true,
    data: [],
    warnings: [],
  };

  // null 또는 undefined 처리
  if (data === null || data === undefined) {
    return result;
  }

  let parsedData: any;

  // 문자열인 경우 JSON 파싱 시도
  if (typeof data === 'string') {
    if (data.trim() === '') {
      return result; // 빈 문자열은 빈 배열로 처리
    }

    try {
      parsedData = JSON.parse(data);
    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  } else {
    parsedData = data;
  }

  // 배열이 아닌 경우 처리
  if (!Array.isArray(parsedData)) {
    return {
      success: false,
      data: [],
      errors: [`Expected array, got ${typeof parsedData}`],
    };
  }

  // 각 관계 항목 검증
  const validRelationships: Relationship[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  parsedData.forEach((item, index) => {
    try {
      const validatedRelationship = RelationshipSchema.parse(item);
      validRelationships.push(validatedRelationship);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e =>
          `Item ${index}: ${e.path.join('.')} - ${e.message}`
        );
        errors.push(...errorMessages);
      } else {
        errors.push(`Item ${index}: Unexpected validation error`);
      }

      // 부분적 복구 시도
      if (typeof item === 'object' && item !== null) {
        const partialRelationship = attemptPartialRecovery(item, index, warnings);
        if (partialRelationship) {
          validRelationships.push(partialRelationship);
        }
      }
    }
  });

  result.data = validRelationships;
  result.success = errors.length === 0;

  if (errors.length > 0) {
    result.errors = errors;
  }

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}

/**
 * 노드 위치 데이터를 안전하게 파싱합니다.
 *
 * @param data - 파싱할 데이터
 * @returns 파싱 결과
 */
export function safeParseNodePositions(data: unknown): ParseResult<Record<string, { x: number; y: number }>> {
  const result: ParseResult<Record<string, { x: number; y: number }>> = {
    success: true,
    data: {},
    warnings: [],
  };

  // null 또는 undefined 처리
  if (data === null || data === undefined) {
    return result;
  }

  let parsedData: any;

  // 문자열인 경우 JSON 파싱 시도
  if (typeof data === 'string') {
    if (data.trim() === '') {
      return result; // 빈 문자열은 빈 객체로 처리
    }

    try {
      parsedData = JSON.parse(data);
    } catch (error) {
      return {
        success: false,
        data: {},
        errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  } else {
    parsedData = data;
  }

  // 객체가 아닌 경우 처리
  if (typeof parsedData !== 'object' || parsedData === null) {
    return {
      success: false,
      data: {},
      errors: [`Expected object, got ${typeof parsedData}`],
    };
  }

  try {
    const validated = NodePositionsSchema.parse(parsedData);
    result.data = validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e =>
        `${e.path.join('.')}: ${e.message}`
      );
      return {
        success: false,
        data: {},
        errors,
      };
    }

    return {
      success: false,
      data: {},
      errors: ['Unexpected validation error'],
    };
  }

  return result;
}

/**
 * 손상된 관계 데이터의 부분적 복구를 시도합니다.
 *
 * @param item - 복구할 관계 아이템
 * @param index - 아이템 인덱스 (로깅용)
 * @param warnings - 경고 메시지 배열
 * @returns 복구된 관계 또는 null
 */
function attemptPartialRecovery(
  item: any,
  index: number,
  warnings: string[]
): Relationship | null {
  const hasFrom = typeof item.from === 'string' && item.from.length > 0;
  const hasTo = typeof item.to === 'string' && item.to.length > 0;
  const hasValidType = typeof item.type === 'string' &&
    ['PEER', 'SUPERVISOR', 'SUBORDINATE', 'NULL'].includes(item.type);

  // 최소 요구사항 확인
  if (!hasFrom || !hasTo) {
    warnings.push(`Item ${index}: Missing required from/to fields, skipping`);
    return null;
  }

  // 타입이 유효하지 않은 경우 기본값 사용
  let type: RelationshipType = hasValidType ? item.type : 'PEER';
  if (!hasValidType) {
    warnings.push(`Item ${index}: Invalid type "${item.type}", defaulting to PEER`);
  }

  return {
    from: item.from,
    to: item.to,
    type,
  };
}

/**
 * 팀 데이터 전체를 안전하게 파싱합니다.
 *
 * @param teamData - 원본 팀 데이터 (Redis에서 가져온 것)
 * @returns 파싱된 팀 데이터
 */
export function safeParseTeamData(teamData: any): {
  relationships: Relationship[];
  nodePositions: Record<string, { x: number; y: number }>;
  parseErrors: string[];
  parseWarnings: string[];
} {
  const relationshipsResult = safeParseRelationships(teamData.relationships);
  const positionsResult = safeParseNodePositions(teamData.nodePositions);

  const parseErrors: string[] = [
    ...(relationshipsResult.errors || []),
    ...(positionsResult.errors || []),
  ];

  const parseWarnings: string[] = [
    ...(relationshipsResult.warnings || []),
    ...(positionsResult.warnings || []),
  ];

  // 파싱 오류를 로깅
  if (parseErrors.length > 0) {
    console.error('Team data parsing errors:', parseErrors);
  }

  if (parseWarnings.length > 0) {
    console.warn('Team data parsing warnings:', parseWarnings);
  }

  return {
    relationships: relationshipsResult.data,
    nodePositions: positionsResult.data,
    parseErrors,
    parseWarnings,
  };
}

/**
 * 관계 데이터를 안전하게 직렬화합니다.
 *
 * @param relationships - 직렬화할 관계 배열
 * @returns JSON 문자열
 */
export function safeStringifyRelationships(relationships: Relationship[]): string {
  try {
    // 직렬화 전 데이터 검증
    const validatedRelationships = relationships.filter(rel =>
      rel &&
      typeof rel.from === 'string' &&
      typeof rel.to === 'string' &&
      typeof rel.type === 'string' &&
      rel.from.length > 0 &&
      rel.to.length > 0
    );

    return JSON.stringify(validatedRelationships);
  } catch (error) {
    console.error('Failed to stringify relationships:', error);
    return '[]'; // 실패 시 빈 배열
  }
}

/**
 * 노드 위치 데이터를 안전하게 직렬화합니다.
 *
 * @param positions - 직렬화할 위치 객체
 * @returns JSON 문자열
 */
export function safeStringifyNodePositions(positions: Record<string, { x: number; y: number }>): string {
  try {
    // 직렬화 전 데이터 검증
    const validatedPositions: Record<string, { x: number; y: number }> = {};

    Object.entries(positions).forEach(([key, value]) => {
      if (
        key &&
        value &&
        typeof value.x === 'number' &&
        typeof value.y === 'number' &&
        isFinite(value.x) &&
        isFinite(value.y)
      ) {
        validatedPositions[key] = {
          x: value.x,
          y: value.y,
        };
      }
    });

    return JSON.stringify(validatedPositions);
  } catch (error) {
    console.error('Failed to stringify node positions:', error);
    return '{}'; // 실패 시 빈 객체
  }
}

/**
 * 파싱 결과의 성공 여부를 확인하는 타입 가드
 */
export function isSuccessfulParse<T>(result: ParseResult<T>): result is ParseResult<T> & { success: true } {
  return result.success;
}

/**
 * 개발 모드에서 파싱 결과를 콘솔에 출력합니다.
 */
export function debugParseResult<T>(result: ParseResult<T>, label: string): void {
  if (process.env.NODE_ENV === 'development') {
    console.group(`Parse Result: ${label}`);
    console.log('Success:', result.success);
    console.log('Data:', result.data);

    if (result.errors?.length) {
      console.error('Errors:', result.errors);
    }

    if (result.warnings?.length) {
      console.warn('Warnings:', result.warnings);
    }

    console.groupEnd();
  }
}