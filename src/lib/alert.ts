/**
 * D-2 알림 + 답글 처리 공통 로직.
 *
 * 캘린더 이벤트의 extendedProperties.private에 다음을 저장:
 *  - alertGroupId: 알림 발송된 팀챗방 ID
 *  - alertMessageId: 알림 메시지 ID (root)
 *  - alertSentAt: ISO timestamp
 *  - userChatId: 원본 유저챗 ID (옵션, 답글 처리시 활용)
 *  - status: 'open' | 'done' | 'cancelled'
 */
import {
  fetchGroupThreadMessages,
  managerMention,
  sendGroupMessage,
  teamMention,
  KR_CX_CONTENT_TEAM_ID,
  urlLink,
  type Manager,
  type Message,
} from './channeltalk';
import {
  getIssueEvent,
  updateIssueEventTitle,
  updateIssueEventDate,
  deleteIssueEvent,
  getCalendarClient,
} from './google-calendar';

// 한국 공휴일은 그대로 보냄 (사용자 결정), 토/일만 다음 평일로 미룸
function isWeekend(yyyyMmDd: string): boolean {
  const d = new Date(`${yyyyMmDd}T00:00:00+09:00`);
  const day = d.getUTCDay(); // 0=일, 6=토 (UTC지만 KST 변환 후 같은 weekday)
  return day === 0 || day === 6;
}

function nextWeekday(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00+09:00`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** 오늘 기준 D-2가 토/일이면 다음 평일로 이연.
 *  즉, "오늘 알림을 보내야 하는 트래킹 날짜"를 반환. */
export function trackingDateToAlertOn(today: string): string {
  // today + 2일 = 트래킹 날짜
  const todayDate = new Date(`${today}T00:00:00+09:00`);
  todayDate.setUTCDate(todayDate.getUTCDate() + 2);
  return todayDate.toISOString().slice(0, 10);
}

/** alertDate(오늘) 기준 어떤 이벤트들이 알림 대상인지 — 평일 보정 적용 */
export function isAlertDay(today: string, eventDate: string): boolean {
  // eventDate(트래킹 날짜)에 해당하는 알림은 normally eventDate - 2일에 보냄.
  // 그날이 토/일이면 다음 평일로 미룸.
  const ed = new Date(`${eventDate}T00:00:00+09:00`);
  ed.setUTCDate(ed.getUTCDate() - 2);
  let alertDay = ed.toISOString().slice(0, 10);
  while (isWeekend(alertDay)) {
    alertDay = nextWeekday(alertDay);
    // 단, 알림일이 트래킹 당일을 넘지 않도록
    if (alertDay >= eventDate) break;
  }
  return alertDay === today;
}

/** D-2 알림 메시지 빌드 */
export function buildAlertMessage(args: {
  summary: string;
  trackingDate: string;
  cxManager: Manager | null;
  productManager: Manager | null;
  userChatLink: string | null;
  teamChatLink: string | null;
  calendarLink: string;
}): string {
  const team = teamMention(KR_CX_CONTENT_TEAM_ID, "KR-CX-Content");
  const cx = args.cxManager ? managerMention(args.cxManager) : "(CX 미지정)";
  const pm = args.productManager ? managerMention(args.productManager) : "(제품팀 미지정)";

  const lines = [
    `${team}\n📌 [D-2 트래킹 예정] ${args.trackingDate}`,
    "",
    `• 이슈: ${args.summary}`,
    `• CX: ${cx}`,
    `• 제품팀: ${pm}`,
  ];
  if (args.userChatLink) lines.push(`• 유저챗: ${urlLink(args.userChatLink)}`);
  if (args.teamChatLink) lines.push(`• 팀챗: ${urlLink(args.teamChatLink)}`);
  lines.push(`• 캘린더: ${urlLink(args.calendarLink)}`);
  lines.push("");
  lines.push("처리 후 이 스레드에 답글로 알려주세요:");
  lines.push("`완료` / `지연 5/6` / `취소`");
  return lines.join("\n");
}

// ── 캘린더 클라이언트는 google-calendar.ts의 getCalendarClient를 재사용 ──

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error("GOOGLE_CALENDAR_ID 누락");
  return id;
}

export interface IssueEventFull {
  id: string;
  summary: string;
  description: string;
  date: string;
  htmlLink: string;
  extProps: Record<string, string>;
}

/** 알림이 필요한 미완료 이벤트 후보를 모두 가져옴 (오늘 ± 7일) */
export async function listOpenEvents(today: string, daysAhead = 14): Promise<IssueEventFull[]> {
  const cal = getCalendarClient();
  const start = new Date(`${today}T00:00:00+09:00`);
  start.setUTCDate(start.getUTCDate() - 1); // 어제부터
  const end = new Date(`${today}T00:00:00+09:00`);
  end.setUTCDate(end.getUTCDate() + daysAhead);
  const res = await cal.events.list({
    calendarId: getCalendarId(),
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    timeZone: "Asia/Seoul",
    singleEvents: true,
    maxResults: 500,
  });
  return (res.data.items || [])
    .filter((ev) => ev.id && ev.summary && ev.start?.date) // 종일 이벤트만
    .map((ev) => ({
      id: ev.id || "",
      summary: ev.summary || "",
      description: ev.description || "",
      date: ev.start?.date || "",
      htmlLink: ev.htmlLink || "",
      extProps: (ev.extendedProperties?.private as Record<string, string>) || {},
    }));
}

export async function patchEventExtProps(
  eventId: string,
  patch: Record<string, string>,
): Promise<void> {
  const cal = getCalendarClient();
  await cal.events.patch({
    calendarId: getCalendarId(),
    eventId,
    requestBody: {
      extendedProperties: { private: patch },
    },
  });
}

// ── 답글 명령 인식 ─────────────────────────────────────────────────────────────

export type ReplyCommand =
  | { type: "complete" }
  | { type: "delay"; date: string }
  | { type: "cancel" }
  | { type: "none" };

export function parseReplyCommand(plainText: string): ReplyCommand {
  const t = (plainText || "").trim();
  if (!t) return { type: "none" };

  // 완료
  if (/^완료\b/.test(t)) return { type: "complete" };

  // 지연 X/X 또는 지연 X월 X일
  const delaySlash = t.match(/^지연\s+(\d{1,2})\/(\d{1,2})/);
  if (delaySlash) {
    const month = parseInt(delaySlash[1], 10);
    const day = parseInt(delaySlash[2], 10);
    const year = new Date().getFullYear();
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // 만약 그 날짜가 이미 과거면 내년으로
    const today = new Date().toISOString().slice(0, 10);
    if (candidate < today) {
      return {
        type: "delay",
        date: `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
    return { type: "delay", date: candidate };
  }

  const delayKor = t.match(/^지연\s+(\d{1,2})월\s*(\d{1,2})일?/);
  if (delayKor) {
    const month = parseInt(delayKor[1], 10);
    const day = parseInt(delayKor[2], 10);
    const year = new Date().getFullYear();
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    if (candidate < today) {
      return {
        type: "delay",
        date: `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
    return { type: "delay", date: candidate };
  }

  // 취소 또는 삭제
  if (/^(취소|삭제)\b/.test(t)) return { type: "cancel" };

  return { type: "none" };
}

/** 같은 답글에 대해 이미 처리(확인 답글 발송)됐는지 — 마커로 idempotency 보장 */
export function alreadyProcessed(replies: Message[], afterTs: number, botMarker: string): boolean {
  return replies.some(
    (m) => m.createdAt > afterTs && (m.plainText || "").includes(botMarker),
  );
}

/** 답글 처리 — 명령에 따라 캘린더 업데이트 + 확인 답글 발송.
 *  반환: 처리 결과 메시지 (확인 답글로 발송된 텍스트), null이면 처리 안 함 */
export async function processReply(args: {
  groupId: string;
  rootMessageId: string;
  reply: Message;
  eventId: string;
}): Promise<string | null> {
  const cmd = parseReplyCommand(args.reply.plainText || "");
  if (cmd.type === "none") return null;

  // 같은 reply에 대해 이미 처리됐으면 스킵 (확인 답글에 marker 포함)
  const replies = await fetchGroupThreadMessages(args.groupId, args.rootMessageId, 100);
  const botMarker = `[${args.reply.id}]`;
  if (alreadyProcessed(replies, args.reply.createdAt, botMarker)) return null;

  let confirmText = "";
  try {
    if (cmd.type === "complete") {
      const ev = await getIssueEvent(args.eventId);
      if (!ev) return null;
      const newTitle = ev.summary.replace(/^⬜\s*/, "✅ ");
      await updateIssueEventTitle(args.eventId, newTitle);
      await patchEventExtProps(args.eventId, { status: "done" });
      confirmText = `✅ 완료 처리했어요. ${botMarker}`;
    } else if (cmd.type === "delay") {
      await updateIssueEventDate(args.eventId, cmd.date);
      // 알림 다시 잡힘 — alertMessageId 초기화
      await patchEventExtProps(args.eventId, {
        alertMessageId: "",
        alertSentAt: "",
      });
      confirmText = `📅 ${cmd.date}로 변경했어요. (D-2 알림 다시 발송 예정) ${botMarker}`;
    } else if (cmd.type === "cancel") {
      await deleteIssueEvent(args.eventId);
      confirmText = `🗑 일정을 삭제했어요. ${botMarker}`;
    }
  } catch (e) {
    confirmText = `⚠ 처리 실패: ${e instanceof Error ? e.message : String(e)} ${botMarker}`;
  }

  if (confirmText) {
    await sendGroupMessage(args.groupId, confirmText, args.rootMessageId);
    return confirmText;
  }
  return null;
}
