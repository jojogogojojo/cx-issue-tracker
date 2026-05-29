/**
 * Google Calendar API — 이슈 일정 등록/조회/수정/삭제.
 * OAuth 2.0 refresh token으로 인증 (Workspace 정책상 서비스 계정에 쓰기 권한 부여 불가해서 OAuth 사용).
 */
import { google, calendar_v3 } from "googleapis";

export function getCalendarClient(): calendar_v3.Calendar {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN 환경변수 모두 필요",
    );
  }

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground",
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  return google.calendar({ version: "v3", auth: oauth2 });
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error("GOOGLE_CALENDAR_ID 환경변수 누락");
  return id;
}

export interface CreateIssueEventParams {
  summary: string; // "⬜ [이슈 요약]"
  description: string;
  date: string; // YYYY-MM-DD
}

export interface IssueEvent {
  id: string;
  htmlLink: string;
  summary: string;
  description: string;
  date: string;
}

function addOneDay(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createIssueEvent(params: CreateIssueEventParams): Promise<IssueEvent> {
  const cal = getCalendarClient();
  const calendarId = getCalendarId();
  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { date: params.date },
      end: { date: addOneDay(params.date) },
      reminders: { useDefault: false, overrides: [] }, // attendee 안 씀, 알림은 채널톡 봇이 따로
    },
  });
  const ev = res.data;
  return {
    id: ev.id || "",
    htmlLink: ev.htmlLink || "",
    summary: ev.summary || params.summary,
    description: ev.description || params.description,
    date: params.date,
  };
}

export async function getIssueEvent(eventId: string): Promise<IssueEvent | null> {
  const cal = getCalendarClient();
  try {
    const res = await cal.events.get({ calendarId: getCalendarId(), eventId });
    const ev = res.data;
    return {
      id: ev.id || "",
      htmlLink: ev.htmlLink || "",
      summary: ev.summary || "",
      description: ev.description || "",
      date: ev.start?.date || "",
    };
  } catch {
    return null;
  }
}

export async function updateIssueEventTitle(eventId: string, summary: string): Promise<void> {
  const cal = getCalendarClient();
  await cal.events.patch({
    calendarId: getCalendarId(),
    eventId,
    requestBody: { summary },
  });
}

export async function updateIssueEventDate(eventId: string, date: string): Promise<void> {
  const cal = getCalendarClient();
  await cal.events.patch({
    calendarId: getCalendarId(),
    eventId,
    requestBody: { start: { date }, end: { date: addOneDay(date) } },
  });
}

export async function deleteIssueEvent(eventId: string): Promise<void> {
  const cal = getCalendarClient();
  await cal.events.delete({ calendarId: getCalendarId(), eventId });
}

/** [start, end] 사이 종일 이벤트 조회 — D-2 알림 봇용 */
export async function listIssueEventsByDate(date: string): Promise<IssueEvent[]> {
  const cal = getCalendarClient();
  const res = await cal.events.list({
    calendarId: getCalendarId(),
    timeMin: new Date(`${date}T00:00:00+09:00`).toISOString(),
    timeMax: new Date(`${addOneDay(date)}T00:00:00+09:00`).toISOString(),
    timeZone: "Asia/Seoul",
    singleEvents: true,
    maxResults: 200,
  });
  return (res.data.items || []).map((ev) => ({
    id: ev.id || "",
    htmlLink: ev.htmlLink || "",
    summary: ev.summary || "",
    description: ev.description || "",
    date: ev.start?.date || date,
  }));
}
