export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-zinc-50">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold mb-4">📝 이슈 트래커</h1>
        <p className="text-lg text-zinc-600 mb-8">
          채널톡 유저챗에서{" "}
          <code className="bg-zinc-200 px-2 py-1 rounded text-base">
            /이슈트래커
          </code>{" "}
          커맨드로 호출하면, AI가 대화 내용을 분석해 KR CX 이슈트래커
          캘린더에 자동 등록합니다.
        </p>

        <div className="bg-white rounded-lg shadow p-6 text-left">
          <h2 className="text-xl font-semibold mb-3">동작 흐름</h2>
          <ol className="space-y-2 text-sm text-zinc-700 list-decimal list-inside">
            <li>매니저가 유저챗에서 <code>/이슈트래커</code> 호출</li>
            <li>모달에서 트래킹 날짜만 선택</li>
            <li>핸들러가 유저챗 전체 메시지 조회</li>
            <li>Claude AI가 이슈 요약·팀챗 링크·제품팀 담당자 추출</li>
            <li>Google Calendar에 종일 이벤트 등록 (<code>⬜ [요약]</code>)</li>
            <li>D-2 오전 10시에 채널톡 팀챗방 멘션 알림</li>
          </ol>
        </div>

        <div className="mt-6 text-xs text-zinc-500 space-y-1">
          <p>
            API: <code>POST /api/command</code> · <code>POST /api/register</code>
          </p>
          <p>
            Health: <code>GET /api/ping</code>
          </p>
        </div>
      </div>
    </main>
  );
}
