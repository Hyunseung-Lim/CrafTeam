/**
 * 사용자 ID 상수 정의
 * 전체 애플리케이션에서 일관된 사용자 식별자를 사용하기 위함
 */

// 사용자 ID (전체 시스템에서 통일하여 사용)
export const USER_ID = "Me";

// 레거시 호환을 위한 한글 사용자 ID (단계적으로 제거 예정)
export const LEGACY_USER_ID = "나";

// 사용자 ID 확인 유틸리티
export function isUserIdVariant(id: string): boolean {
  return id === USER_ID || id === LEGACY_USER_ID;
}

// ID 정규화 (레거시 ID를 표준 ID로 변환)
export function normalizeUserId(id: string): string {
  return isUserIdVariant(id) ? USER_ID : id;
}