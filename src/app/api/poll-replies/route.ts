/**
 * 답글 폴링 — GitHub Actions cron이 5분마다 호출.
 *
 * 동작:
 * 1. 알림 발송된 이벤트(alertMessageId 있음, ⬜ prefix) 모두 조회
 * 2. 각 이벤트의 알림 스레드 답글 조회
 * 3. 답글에서 명령 인식 (`완료` / `지연 X/X` / `취소`)
 * 4. 명령 처리 → 캘린더 업데이트 + 확인 답글 발송
 * 5. 마커로 idempotency 보장 (같은 답글 재처리 방지)
 *
 * 인증: Authorization: Bearer ${TRIGGER_SECRET}
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchGroupThreadMessages } from "@/lib/channeltalk";
import { listOpenEvents, processReply } from "@/lib/alert";

function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const triggerSecret = process.env.TRIGGER_SECRET;
  if (!triggerSecret) {
    return NextResponse.json({ error: "TRIGGER_SECRET 미설정" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth.replace(/^Bearer\s+/i, "") !== triggerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getTodayKst();

  let events;
  try {
    events = await listOpenEvents(today, 14);
  } catch (e) {
    return NextResponse.json(
      { error: `캘린더 조회 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // 알림 발송된 + 미완료 이벤트만 폴링 대상
  const targets = events.filter(
    (ev) =>
      ev.summary.startsWith("⬜") &&
      ev.extProps.alertMessageId &&
      ev.extProps.alertGroupId,
  );

  const summary: Array<{
    eventId: string;
    processed: number;
    error?: string;
  }> = [];

  for (const ev of targets) {
    const groupId = ev.extProps.alertGroupId;
    const rootId = ev.extProps.alertMessageId;
    if (!groupId || !rootId) continue;
    let processed = 0;
    try {
      const replies = await fetchGroupThreadMessages(groupId, rootId, 100);
      const alertSentAt = ev.extProps.alertSentAt
        ? new Date(ev.extProps.alertSentAt).getTime()
        : 0;
      // 알림 시점 이후의 답글만 (자신 제외)
      const candidates = replies.filter(
        (m) => m.id !== rootId && m.createdAt > alertSentAt && m.personType !== "bot",
      );
      for (const reply of candidates) {
        const result = await processReply({
          groupId,
          rootMessageId: rootId,
          reply,
          eventId: ev.id,
        });
        if (result) processed++;
      }
      summary.push({ eventId: ev.id, processed });
    } catch (e) {
      summary.push({
        eventId: ev.id,
        processed,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    targetsCount: targets.length,
    totalProcessed: summary.reduce((acc, s) => acc + s.processed, 0),
    perEvent: summary,
  });
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "답글 폴링 엔드포인트 — POST + Bearer auth 필요",
  });
}
