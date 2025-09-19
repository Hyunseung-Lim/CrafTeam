/**
 * API 호출을 위한 동적 baseURL 생성 유틸리티
 */

/**
 * 요청 객체나 헤더에서 동적으로 baseURL을 생성합니다.
 * 프로덕션에서는 환경변수를, 개발환경에서는 요청 헤더에서 포트를 추출합니다.
 */
export function getBaseUrl(request?: Request): string {
  // 프로덕션 환경에서는 환경변수 우선 사용
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }

  // 개발 환경에서는 요청 헤더에서 호스트 정보 추출
  if (request) {
    const host = request.headers.get('host');
    if (host) {
      const protocol = request.headers.get('x-forwarded-proto') || 'http';
      return `${protocol}://${host}`;
    }
  }

  // 기본값: 가장 일반적인 개발 포트들을 순서대로 시도
  // Next.js는 3000이 사용 중이면 자동으로 다음 포트를 찾음
  return 'http://localhost:3003';
}

/**
 * NextRequest 객체에서 baseURL을 추출합니다.
 */
export function getBaseUrlFromNextRequest(request: any): string {
  return getBaseUrl(request);
}

/**
 * API 라우트에서 사용할 수 있는 간단한 baseURL 추출기
 */
export function getApiBaseUrl(headers: Headers): string {
  // 프로덕션 환경변수 확인
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }

  // 헤더에서 호스트 정보 추출
  const host = headers.get('host');
  if (host) {
    const protocol = headers.get('x-forwarded-proto') || 'http';
    return `${protocol}://${host}`;
  }

  // 현재 실행 중인 포트를 감지하려고 시도
  const port = process.env.PORT ||
               process.env.NEXT_PORT ||
               '3000';

  return `http://localhost:${port}`;
}

/**
 * 환경변수나 현재 포트를 기반으로 baseURL을 생성합니다.
 * 요청 객체가 없는 경우 사용
 */
export function getDefaultBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }

  // Node.js 프로세스의 환경에서 포트 감지
  const port = process.env.PORT ||
               process.env.NEXT_PORT ||
               '3000';

  return `http://localhost:${port}`;
}