/**
 * D-2 알림 발송 — GitHub Actions cron이 매일 한 번 호출.
 *
 * 동작:
 * 1. 캘린더에서 향후 14일치 이벤트 조회
 * 2. 트래킹 날짜 기준 D-2 알림 대상 식별 (토/일이면 다음 평일로 이연)
 * 3. 이미 알림 발송된 이벤트는 스킵 (extendedProperties.alertMessageId)
 * 4. ⬜ prefix만 대상 (✅, 🗑은 스킵)
 * 5. 그룹방에 알림 메시지 발송 → message ID 캘린더 이벤트에 저장
 *
 * 인증: Authorization: Bearer ${TRIGGER_SECRET}
 */
import { NextRequest, NextResponse } from "next/server";
import {
  buildAlertMessage,
  isAlertDay,
  listOpenEvents,
  patchEventExtProps,
  type IssueEventFull,
} from "@/lib/alert";
import { findManager, sendGroupMessage } from "@/lib/channeltalk";

function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function parseDescription(desc: string): {
  userChatLink: string | null;
  teamChatLink: string | null;
  cxName: string | null;
  pmName: string | null;
} {
  const out = {
    userChatLink: null as string | null,
    teamChatLink: null as string | null,
    cxName: null as string | null,
    pmName: null as string | null,
  };
  for (const raw of desc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("유저챗:")) {
      const url = line.replace(/^유저챗:\s*/, "");
      if (url.startsWith("http")) out.userChatLink = url;
    } else if (line.startsWith("팀챗:")) {
      const url = line.replace(/^팀챗:\s*/, "");
      if (url.startsWith("http")) out.teamChatLink = url;
    } else if (line.startsWith("CX 담당:")) {
      const m = line.replace(/^CX 담당:\s*/, "").match(/^([^<\s]+)/);
      if (m) out.cxName = m[1];
    } else if (line.startsWith("제품팀 담당:")) {
      const m = line.replace(/^제품팀 담당:\s*/, "").match(/^([^<\s]+)/);
      if (m) out.pmName = m[1];
    }
  }
  return out;
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

  const groupId = process.env.ISSUE_TRACKER_ALERT_GROUP_ID || "356599";
  const today = getTodayKst();

  let events: IssueEventFull[];
  try {
    events = await listOpenEvents(today, 14);
  } catch (e) {
    return NextResponse.json(
      { error: `캘린더 조회 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  const candidates = events.filter((ev) => {
    if (!ev.summary.startsWith("⬜")) return false; // 완료/취소된 건 제외
    if (ev.extProps.alertMessageId) return false; // 이미 알림 발송됨
    return isAlertDay(today, ev.date);
  });

  const results: Array<{ eventId: string; status: "sent" | "error"; error?: string }> = [];

  for (const ev of candidates) {
    try {
      const summary = ev.summary.replace(/^⬜\s*/, "");
      const meta = parseDescription(ev.description);
      const cx = meta.cxName ? await findManager(meta.cxName) : null;
      const pm = meta.pmName ? await findManager(meta.pmName) : null;
      const text = buildAlertMessage({
        summary,
        trackingDate: ev.date,
        cxManager: cx,
        productManager: pm,
        userChatLink: meta.userChatLink,
        teamChatLink: meta.teamChatLink,
        calendarLink: ev.htmlLink,
      });
      const sent = await sendGroupMessage(groupId, text);
      if (sent.id) {
        await patchEventExtProps(ev.id, {
          alertGroupId: groupId,
          alertMessageId: sent.id,
          alertSentAt: new Date().toISOString(),
          status: "open",
        });
        results.push({ eventId: ev.id, status: "sent" });
      } else {
        results.push({ eventId: ev.id, status: "error", error: "메시지 ID 없음" });
      }
    } catch (e) {
      results.push({
        eventId: ev.id,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    groupId,
    candidatesCount: candidates.length,
    sent: results.filter((r) => r.status === "sent").length,
    errors: results.filter((r) => r.status === "error"),
  });
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "D-2 알림 엔드포인트 — POST + Bearer auth 필요",
  });
}
