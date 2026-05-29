# CLAUDE.md — Next.js Template Security Rules

이 프로젝트는 내부 K8s 클러스터에 배포되는 Next.js 애플리케이션 템플릿입니다.
비개발직군이 Claude Code로 바이브코딩하여 서비스를 만듭니다.
아래 보안 규칙은 **절대적**이며 예외 없이 따라야 합니다.

## Commands

```
Dev:       npm run dev
Build:     npm run build
Lint:      npm run lint
Typecheck: npx tsc --noEmit
```

## 절대 금지 (STRICT — 위반 시 코드 생성 거부)

1. **시크릿 하드코딩 금지** — API 키, 비밀번호, 토큰, 커넥션 스트링을 소스코드에 절대 직접 작성하지 마세요. 반드시 `process.env`로 환경변수를 사용하세요.
2. **`eval()`, `Function()` 생성자, `new Function()` 사용 금지** — 동적 입력으로 코드를 실행하는 것은 절대 금지입니다.
3. **`dangerouslySetInnerHTML` 사용 금지** — DOMPurify로 새니타이징하지 않는 한 절대 사용하지 마세요. 사용 시 반드시 이유를 설명하세요.
4. **TypeScript strict 모드 비활성화 금지** — `@ts-ignore`, `@ts-expect-error`를 이유 없이 추가하지 마세요.
5. **검증 없는 패키지 설치 금지** — npm 패키지 설치 전 주간 다운로드 수, 최근 업데이트, 알려진 취약점을 확인하세요.
6. **내부 서비스 URL 클라이언트 노출 금지** — DB 커넥션 스트링, 클러스터 내부 주소를 클라이언트 코드(`'use client'` 컴포넌트, `NEXT_PUBLIC_*` 변수)에 절대 노출하지 마세요.
7. **`chmod 777` 또는 world-writable 권한 금지**
8. **SQL 문자열 연결 금지** — DB 쿼리는 반드시 파라미터화된 쿼리 또는 ORM을 사용하세요.
9. **`.env` 파일 커밋 금지** — `.env.example`만 커밋하세요.
10. **`--no-verify` 플래그 사용 금지** — git 훅을 우회하지 마세요.

## 경고 (WARNING — 대안을 제시하며 경고)

1. `any` 타입 사용을 피하세요. `unknown` + 타입 가드를 사용하세요.
2. 모든 API 라우트에서 입력을 `zod` 등으로 검증하세요.
3. `fetch` 호출 시 에러 핸들링을 반드시 포함하세요.
4. 민감한 작업은 Server Component / Server Action을 사용하세요.
5. 보안 관련 이벤트(인증 실패 등)를 로깅하되, 비밀번호/토큰/PII는 절대 로깅하지 마세요.

## 코딩 규칙

- App Router 사용 (Pages Router 금지)
- 코드 작성 완료 후 `npm run lint`와 `npx tsc --noEmit` 실행하여 문제 없는지 확인
- 환경변수는 `NEXT_PUBLIC_` 접두사가 있는 것만 클라이언트에서 접근 가능
- 새 환경변수 추가 시 `.env.example`에도 반드시 추가
