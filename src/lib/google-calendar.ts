/**
 * Google Calendar API — 이슈 일정 등록/조회/수정/삭제.
 * OAuth2 refresh token으로 직접 REST API 호출 (googleapis SDK 제외 — Lambda 크기 절감).
 */

function getOAuthCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN 환경변수 모두 필요');
  }
  return { clientId, clientSecret, refreshToken };
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error('GOOGLE_CALENDAR_ID 환경변수 누락');
  return id;
}

// access token 캐시 (Lambda warm 재사용, 만료 1분 전에 갱신)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const { clientId, clientSecret, refreshToken } = getOAuthCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) {
    throw new Error(`OAuth2 토큰 갱신 실패: ${data.error ?? JSON.stringify(data)}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

async function calendarFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (method === 'DELETE' && res.status === 204) return undefined as T;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface CreateIssueEventParams {
  summary: string;
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

interface GCalEvent {
  id?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  start?: { date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export async function createIssueEvent(params: CreateIssueEventParams): Promise<IssueEvent> {
  const ev = await calendarFetch<GCalEvent>('POST', `/calendars/${encodeURIComponent(getCalendarId())}/events`, {
    summary: params.summary,
    description: params.description,
    start: { date: params.date },
    end: { date: addOneDay(params.date) },
    reminders: { useDefault: false, overrides: [] },
  });
  return {
    id: ev.id ?? '',
    htmlLink: ev.htmlLink ?? '',
    summary: ev.summary ?? params.summary,
    description: ev.description ?? params.description,
    date: params.date,
  };
}

export async function getIssueEvent(eventId: string): Promise<IssueEvent | null> {
  try {
    const ev = await calendarFetch<GCalEvent>(
      'GET',
      `/calendars/${encodeURIComponent(getCalendarId())}/events/${encodeURIComponent(eventId)}`,
    );
    return {
      id: ev.id ?? '',
      htmlLink: ev.htmlLink ?? '',
      summary: ev.summary ?? '',
      description: ev.description ?? '',
      date: ev.start?.date ?? '',
    };
  } catch {
    return null;
  }
}

export async function updateIssueEventTitle(eventId: string, summary: string): Promise<void> {
  await calendarFetch('PATCH', `/calendars/${encodeURIComponent(getCalendarId())}/events/${encodeURIComponent(eventId)}`, { summary });
}

export async function updateIssueEventDate(eventId: string, date: string): Promise<void> {
  await calendarFetch('PATCH', `/calendars/${encodeURIComponent(getCalendarId())}/events/${encodeURIComponent(eventId)}`, {
    start: { date },
    end: { date: addOneDay(date) },
  });
}

export async function deleteIssueEvent(eventId: string): Promise<void> {
  await calendarFetch('DELETE', `/calendars/${encodeURIComponent(getCalendarId())}/events/${encodeURIComponent(eventId)}`);
}

export async function listIssueEventsByDate(date: string): Promise<IssueEvent[]> {
  const data = await calendarFetch<{ items?: GCalEvent[] }>('GET', `/calendars/${encodeURIComponent(getCalendarId())}/events`, undefined, {
    timeMin: new Date(`${date}T00:00:00+09:00`).toISOString(),
    timeMax: new Date(`${addOneDay(date)}T00:00:00+09:00`).toISOString(),
    timeZone: 'Asia/Seoul',
    singleEvents: 'true',
    maxResults: '200',
  });
  return (data.items ?? []).map((ev) => ({
    id: ev.id ?? '',
    htmlLink: ev.htmlLink ?? '',
    summary: ev.summary ?? '',
    description: ev.description ?? '',
    date: ev.start?.date ?? date,
  }));
}

// alert.ts에서 사용하는 listOpenEvents용
export async function listEventsByRange(timeMin: string, timeMax: string): Promise<Array<GCalEvent & { extendedProperties?: { private?: Record<string, string> } }>> {
  const data = await calendarFetch<{ items?: GCalEvent[] }>('GET', `/calendars/${encodeURIComponent(getCalendarId())}/events`, undefined, {
    timeMin,
    timeMax,
    timeZone: 'Asia/Seoul',
    singleEvents: 'true',
    maxResults: '500',
  });
  return data.items ?? [];
}

export async function patchEventExtendedProperties(eventId: string, privateProps: Record<string, string>): Promise<void> {
  await calendarFetch('PATCH', `/calendars/${encodeURIComponent(getCalendarId())}/events/${encodeURIComponent(eventId)}`, {
    extendedProperties: { private: privateProps },
  });
}

// alert.ts가 직접 사용하는 getCalendarClient 대신 이 함수를 재사용
export { getCalendarId };
