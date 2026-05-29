# 이슈트래커 설정 가이드

배포 전·후로 사람이 직접 해야 하는 작업 모음.  
순서대로 진행하면 됩니다.

---

## 1. Google 서비스 계정 발급 + 캘린더 공유

이슈트래커가 **KR CX 이슈트래커 캘린더**에 일정을 등록할 수 있게 권한을 줍니다.

### 1-1. Google Cloud 프로젝트 + 서비스 계정

1. https://console.cloud.google.com 접속
2. 좌측 상단 프로젝트 선택 → **새 프로젝트** (또는 기존 채널톡 회사 프로젝트 사용)
3. 좌측 메뉴 → "API 및 서비스" → "라이브러리"
4. 검색창에 **"Google Calendar API"** → 결과 클릭 → **사용 설정**
5. 좌측 메뉴 → "API 및 서비스" → "사용자 인증 정보"
6. 상단 **"+사용자 인증 정보 만들기"** → **"서비스 계정"**
7. 입력:
   - 서비스 계정 이름: `issue-tracker`
   - 서비스 계정 ID: 자동 생성 (예: `issue-tracker@my-project.iam.gserviceaccount.com`)
   - 설명: "CX 이슈 트래커 캘린더 등록용"
8. "만들고 계속하기" → 역할 부여 단계는 **건너뛰기** (캘린더 자체에 권한 줄 거임)
9. 만들기 완료

### 1-2. 키 발급 (JSON)

1. 방금 만든 서비스 계정 클릭 → 상단 "키" 탭
2. **"키 추가"** → "새 키 만들기" → JSON → 만들기
3. JSON 파일이 다운로드됨 — **절대 git에 올리지 말 것**
4. 다운로드된 파일에서 `client_email` 값 복사 (예: `issue-tracker@my-project.iam.gserviceaccount.com`)

### 1-3. 캘린더에 서비스 계정 권한 부여

1. https://calendar.google.com → 좌측 "다른 캘린더" 목록에서 **"KR CX 이슈트래커"** 옆 ⋮ → "설정 및 공유"
2. 하단 "특정 사용자 또는 그룹과 공유"
3. **"사용자 및 그룹 추가"** → 서비스 계정 이메일(1-2에서 복사한 것) 붙여넣기
4. 권한: **"변경 및 공유 관리"** 선택
5. 보내기

### 1-4. 캘린더 ID 확인

같은 페이지 하단 "캘린더 통합" 섹션에 **"캘린더 ID"** 항목.
`c_xxxxxxxx@group.calendar.google.com` 형식. 복사해 둠.

### 1-5. 키 base64 인코딩

터미널에서:
```bash
cat ~/Downloads/{서비스계정-키파일}.json | base64 | pbcopy
```
이렇게 하면 base64 문자열이 클립보드에 복사됨. 이 값을 `GOOGLE_SERVICE_ACCOUNT_KEY`로 사용.

---

## 2. 채널톡 앱 등록 + `/이슈트래커` 커맨드 설정

### 2-1. 앱 만들기

1. https://developers.channel.io 로그인
2. 좌측 "내 앱" → **"+ 새 앱"**
3. 입력:
   - 앱 이름: `이슈 트래커`
   - 설명: `유저챗 이슈를 캘린더에 자동 등록`
4. 만들기 후 `appId` 복사해 둠 (env로 전달)

### 2-2. 앱 토큰 발급

1. 만든 앱 페이지 → "Credentials" 또는 "토큰" 메뉴
2. **새 앱 토큰** 발급 → 복사 (`CHANNELTALK_APP_TOKEN` env로 사용)

### 2-3. WAM 등록

이슈트래커 앱은 트래킹 날짜를 입력받는 모달(WAM)을 띄움.

1. "WAM" 또는 "Web App Module" 메뉴
2. **새 WAM 등록**:
   - 이름: `register`
   - URL: `https://issue-tracker.dmz.exps.ch/wam`
   - 크기: 480 x 600 정도 권장
3. 저장

### 2-4. 커맨드 등록

API 호출로 등록 (developers.channel.io 가이드 참고):

```bash
curl -X PUT "https://app-store-api.channel.io/general/v1/native/functions" \
  -H "x-access-token: ${YOUR_APP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "YOUR_APP_ID",
    "method": "이슈트래커",
    "scope": "desk",
    "params": []
  }'
```

또는 채널톡 개발자 콘솔의 "Functions/Commands" UI에서 등록:
- name: `이슈트래커`
- scope: `desk` (매니저 데스크)
- params: 없음 (모달에서 받음)
- function URL: `https://issue-tracker.dmz.exps.ch/api/command`

### 2-5. 앱 설치

워크스페이스 관리자가 앱을 워크스페이스에 설치해야 매니저들이 `/이슈트래커` 호출 가능.

---

## 3. QWER 배포 + env 등록

CoHouse 표준 절차:

### 3-1. PR 생성

```bash
cd ~/Desktop/CoHouse
git checkout -b feat/issue-tracker
git add projects/issue-tracker registry.json README.md .github/workflows/issue-tracker-ci.yml
git commit -m "Add issue-tracker app — CX 이슈 자동 캘린더 등록"
git push {fork-remote} feat/issue-tracker
gh pr create --repo channel-io/co-house --base exp --head {your-username}:feat/issue-tracker --title "feat: issue-tracker"
```

PR 머지 → exp에 push → Docker 이미지 자동 빌드 (`exp-{hash}` 태그).

### 3-2. QWER에서 프로젝트 생성 (최초 1회)

1. https://qwer.ch.dev/projects 접속 (Okta 로그인)
2. **"+ New Project"** → 이름 `issue-tracker`
3. Image source: ECR `issue-tracker` 선택
4. URL: `issue-tracker.dmz.exps.ch`

### 3-3. 환경 변수 등록

QWER 프로젝트 → Resources → 떠있는 서버 클릭 → config → New (각각)

| 변수명 | 값 |
|--------|-----|
| `CHANNELTALK_ACCESS_KEY` | 사내 채널톡 키 (위크플로우 표준) |
| `CHANNELTALK_ACCESS_SECRET` | 사내 채널톡 시크릿 |
| `CHANNELTALK_APP_TOKEN` | 2-2에서 발급받은 앱 토큰 |
| `CHANNELTALK_APP_ID` | 2-1에서 발급받은 앱 ID |
| `ANTHROPIC_API_KEY` | Prism 또는 Anthropic 키 |
| `ANTHROPIC_API_BASE_URL` | `https://prism.ch.dev` (Prism 사용 시) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 1-5의 base64 문자열 |
| `GOOGLE_CALENDAR_ID` | 1-4의 캘린더 ID |
| `TRIGGER_SECRET` | `openssl rand -base64 32`로 랜덤 생성 |
| `ISSUE_TRACKER_ALERT_GROUP_ID` | `356599` (테스트방, 운영 가서 변경) |

저장 → **Publish** → **Action → rollout**

### 3-4. 배포 확인

```bash
curl https://issue-tracker.dmz.exps.ch/api/ping
# {"status":"ok","timestamp":"..."}
```

---

## 4. GitHub Actions cron 설정

워크플로우 파일은 이미 `~/Desktop/claudecode/weekly-deploy-notify/.github/workflows/`에 추가됨:
- `issue-tracker-alert.yml` — 매일 KST 10:00
- `issue-tracker-poll-replies.yml` — 5분마다

GitHub repo 시크릿에 추가해야 함:
1. https://github.com/jojogogojojo/weekly-deploy-notify (또는 본인 cron repo) → Settings → Secrets → Actions
2. **New repository secret**:
   - `ISSUE_TRACKER_APP_URL` = `https://issue-tracker.dmz.exps.ch`
   - `ISSUE_TRACKER_TRIGGER_SECRET` = QWER에 등록한 `TRIGGER_SECRET`과 동일 값

3. 커밋·푸시:
```bash
cd ~/Desktop/claudecode/weekly-deploy-notify
git add .github/workflows/issue-tracker-*.yml
git commit -m "Add issue-tracker cron workflows"
git push
```

4. Actions 탭에서 워크플로우 수동 실행(`workflow_dispatch`)으로 동작 확인

---

## 5. 통합 테스트

1. 채널톡 매니저 데스크에서 임의 유저챗 열기
2. `/이슈트래커` 호출
3. 모달에서 **2일 후 날짜** 선택 → 등록
4. 응답:
   - ✅ 등록됨 + AI 추출 결과 표시
5. KR CX 이슈트래커 캘린더 → 해당 날짜에 `⬜ [요약]` 일정 확인
6. AI가 못 찾은 항목이 있으면 유저챗 내부 메모로 알림 받음
7. **다음날** 까지 기다리거나 GitHub Actions에서 `Issue Tracker — D-2 Alert` 수동 실행
8. 테스트방(356599)에 알림 메시지 확인
9. 알림 스레드에 `완료` 답글
10. 5분 안에 봇 확인 답글 + 캘린더 ✅로 토글 확인

---

## 운영 전환 (테스트 끝난 후)

QWER에서 `ISSUE_TRACKER_ALERT_GROUP_ID`를 운영 그룹방 ID로 변경 후 rollout.
