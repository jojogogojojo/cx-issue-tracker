# 이슈 트래커

채널톡 유저챗에서 `/이슈트래커` 커맨드를 호출하면 AI가 대화 내용을 분석해 KR CX 이슈트래커 캘린더에 자동 등록하는 앱.

## 주요 기능

- 채널톡 앱 커맨드 핸들러 (`/이슈트래커`) — 트래킹 날짜 입력 모달
- 유저챗 메시지(고객 대화·매니저 답변·내부 메모) 자동 수집
- Claude AI로 이슈 요약·팀챗 링크·제품팀 담당자 추출
- Google Calendar에 이벤트 자동 등록 (`⬜ [이슈 요약]`)
- 추출 실패시 호출 매니저에게 내부 메모로 보강 요청 자동 발송

## 실행 방법

```bash
pnpm install
pnpm dev
```

http://localhost:3000 에서 확인할 수 있습니다.

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|:---:|------|
| `CHANNELTALK_ACCESS_KEY` | O | 채널톡 Open API 인증키 |
| `CHANNELTALK_ACCESS_SECRET` | O | 채널톡 Open API 시크릿 |
| `CHANNELTALK_API_BASE_URL` | X | 채널톡 API Base URL (기본값: `https://api.channel.io`) |
| `CHANNELTALK_APP_TOKEN` | O | 채널톡 앱 토큰 (앱 커맨드 검증용) |
| `ANTHROPIC_API_KEY` | O | Anthropic Claude API 키 |
| `ANTHROPIC_API_BASE_URL` | X | Anthropic API Base URL (Prism 프록시 사용 시) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | O | Google 서비스 계정 키 (base64 JSON) |
| `GOOGLE_CALENDAR_ID` | O | 이슈 등록 대상 캘린더 ID |
| `DESK_BASE_URL` | X | 채널톡 데스크 URL (기본값: `https://desk.channel.io`) |

`.env.example`을 `.env.local`로 복사한 후 실제 값을 입력하세요.

## 동작 흐름

1. 매니저가 유저챗에서 `/이슈트래커` 호출
2. 트래킹 날짜 입력 모달 표시
3. 핸들러가 유저챗 메시지 전체 조회
4. Claude AI로 이슈 요약 / 팀챗 링크 / 제품팀 담당자 추출
5. Google Calendar에 종일 이벤트 등록 (`⬜ [이슈 요약]`)
6. 호출 매니저에게 등록 결과 응답 (AI 추출 내용 포함)
7. 추출 실패 항목이 있으면 유저챗 내부 메모로 "직접 추가 부탁" 메시지 자동 발송 (캘린더 링크 포함)

## 담당자

- Jojo (CX팀)
