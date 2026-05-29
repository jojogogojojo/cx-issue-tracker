"use client";

import { useState, useEffect, useMemo } from "react";

interface WamArgs {
  chatId: string;
  callerId: string;
  channelId: string;
}

interface RegisterResult {
  ok: boolean;
  event: {
    id: string;
    link: string;
    date: string;
    summary: string;
  };
  extracted: {
    summary: string;
    teamChatLink: string | null;
    productManager: { name: string; email?: string } | null;
    productManagerNameRaw: string | null;
  };
  caller: { name: string; email?: string } | null;
  missing: string[];
}

function todayKstYmd(offsetDays = 1): string {
  // KST 기준 오늘 + offsetDays
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().slice(0, 10);
}

export default function WamPage() {
  const [args, setArgs] = useState<WamArgs | null>(null);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 채널톡 WAM은 wamArgs를 URL query 또는 postMessage로 전달.
    // 일단 URL query 우선, 없으면 빈 값.
    const params = new URLSearchParams(window.location.search);
    setArgs({
      chatId: params.get("chatId") || "",
      callerId: params.get("callerId") || "",
      channelId: params.get("channelId") || "",
    });
    setDate(todayKstYmd(1)); // 기본값: 내일
  }, []);

  const today = useMemo(() => todayKstYmd(0), []);

  async function handleSubmit() {
    if (!args || !date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: args.chatId,
          callerId: args.callerId,
          channelId: args.channelId,
          trackingDate: date,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "등록 실패");
      setResult(data as RegisterResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const teamChatStatus = result.extracted.teamChatLink ? (
      <a
        href={result.extracted.teamChatLink}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 underline"
      >
        확인됨
      </a>
    ) : (
      <span className="text-orange-600">미발견 (직접 추가 필요)</span>
    );

    const pm = result.extracted.productManager;
    const pmRaw = result.extracted.productManagerNameRaw;
    const pmStatus = pm
      ? `${pm.name}${pm.email ? ` (${pm.email})` : ""}`
      : pmRaw
        ? `${pmRaw} ⚠ 매니저 매칭 실패`
        : "미발견 (직접 추가 필요)";

    return (
      <main className="p-6 max-w-md mx-auto">
        <h1 className="text-xl font-bold mb-4">✅ 등록됐어요</h1>
        <div className="space-y-3 text-sm">
          <Row label="📅 트래킹" value={`${result.event.date} (종일)`} />
          <Row label="📝 이슈 요약" value={result.extracted.summary} />
          <Row label="🔗 팀챗" value={teamChatStatus} />
          <Row label="👤 제품팀 담당" value={pmStatus} />
          <Row
            label="🙋 CX 담당"
            value={
              result.caller
                ? `${result.caller.name}${result.caller.email ? ` (${result.caller.email})` : ""}`
                : "(조회 실패)"
            }
          />
        </div>
        <a
          href={result.event.link}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-blue-600 underline text-sm"
        >
          캘린더에서 보기 →
        </a>
        {result.missing.length > 0 && (
          <p className="mt-3 text-xs text-orange-600">
            * 미발견 항목({result.missing.join(", ")})은 유저챗 내부 메모로도
            알려드렸어요. 캘린더에서 직접 보강해 주세요.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-2">이슈트래커 등록</h1>
      <p className="text-sm text-gray-600 mb-6">
        트래킹할 날짜를 선택하세요. 이슈 요약·팀챗 링크·제품팀 담당자는 유저챗
        내용을 분석해 자동으로 채워집니다.
      </p>

      <label className="block mb-4">
        <span className="text-sm font-medium mb-1 block">트래킹 날짜</span>
        <input
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full rounded border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      {error && (
        <div className="text-red-600 text-sm mb-3 p-3 bg-red-50 rounded">
          ⚠ {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !date || !args?.chatId}
        className="w-full py-2.5 bg-blue-600 text-white rounded font-medium disabled:opacity-50 hover:bg-blue-700"
      >
        {loading ? "AI 분석 + 등록 중..." : "등록"}
      </button>

      {!args?.chatId && (
        <p className="text-xs text-gray-500 mt-3">
          ⚠ 유저챗 컨텍스트가 비어있어요. 채널톡 커맨드로 호출해야 정상 동작합니다.
        </p>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex">
      <span className="font-medium w-28 flex-shrink-0">{label}</span>
      <span className="flex-1 break-words">{value}</span>
    </div>
  );
}
