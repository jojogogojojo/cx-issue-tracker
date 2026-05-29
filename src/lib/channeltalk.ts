/**
 * 채널톡 Open API 클라이언트.
 * cx-request 패턴 차용 — fetch 기반, 매니저 캐시(10분 TTL), email 우선 매칭.
 */

const BASE_URL = process.env.CHANNELTALK_API_BASE_URL || "https://api.channel.io";
export const DESK_BASE_URL = process.env.DESK_BASE_URL || "https://desk.channel.io";

// 팀 멘션용 — KR-CX-Content 그룹방 ID (cx-request에서 차용)
export const KR_CX_CONTENT_TEAM_ID = "497780";

export interface Manager {
  id: string;
  name: string;
  email?: string;
}

export interface Message {
  id: string;
  chatType: string;
  chatId: string;
  personType?: "user" | "manager" | "bot";
  personId?: string;
  plainText?: string;
  blocks?: unknown[];
  createdAt: number;
  options?: string[]; // ["private"] 등
}

export interface MessagesResponse {
  messages?: Message[];
  managers?: Manager[];
  next?: string;
}

interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

function getCredentials(): { accessKey: string; accessSecret: string } {
  const accessKey = process.env.CHANNELTALK_ACCESS_KEY;
  const accessSecret = process.env.CHANNELTALK_ACCESS_SECRET;
  if (!accessKey || !accessSecret) {
    throw new Error("CHANNELTALK_ACCESS_KEY/SECRET 환경변수 누락");
  }
  return { accessKey, accessSecret };
}

async function callApi<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { accessKey, accessSecret } = getCredentials();
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      "x-access-key": accessKey,
      "x-access-secret": accessSecret,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`채널톡 API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ── 매니저 ────────────────────────────────────────────────────────────────────

interface ManagerCache {
  list: Manager[];
  byId: Map<string, Manager>;
  byEmail: Map<string, Manager>;
  byName: Map<string, Manager>;
  expiresAt: number;
}

const MANAGER_TTL_MS = 10 * 60 * 1000;
let managerCache: ManagerCache | null = null;

function buildManagerCache(list: Manager[]): ManagerCache {
  const byId = new Map<string, Manager>();
  const byEmail = new Map<string, Manager>();
  const byName = new Map<string, Manager>();
  for (const m of list) {
    byId.set(m.id, m);
    if (m.email) byEmail.set(m.email.toLowerCase(), m);
    if (m.name) byName.set(m.name, m);
  }
  return { list, byId, byEmail, byName, expiresAt: Date.now() + MANAGER_TTL_MS };
}

export async function getManagers(): Promise<ManagerCache> {
  if (managerCache && Date.now() < managerCache.expiresAt) return managerCache;
  const all: Manager[] = [];
  let since: string | undefined;
  for (let i = 0; i < 20; i++) {
    const data = await callApi<{ managers?: Manager[]; next?: string }>(
      "/open/v5/managers",
      { query: { limit: 200, since } },
    );
    if (data.managers) all.push(...data.managers);
    if (!data.next) break;
    since = data.next;
  }
  managerCache = buildManagerCache(all);
  return managerCache;
}

export async function findManager(idOrNameOrEmail: string): Promise<Manager | null> {
  const cache = await getManagers();
  if (cache.byId.has(idOrNameOrEmail)) return cache.byId.get(idOrNameOrEmail)!;
  const email = cache.byEmail.get(idOrNameOrEmail.toLowerCase());
  if (email) return email;
  if (cache.byName.has(idOrNameOrEmail)) return cache.byName.get(idOrNameOrEmail)!;
  // 부분 일치 fallback
  const partial = cache.list.find(
    (m) => m.name && (m.name.includes(idOrNameOrEmail) || idOrNameOrEmail.includes(m.name)),
  );
  return partial ?? null;
}

// ── 멘션 헬퍼 ──────────────────────────────────────────────────────────────────

export function managerMention(m: Manager): string {
  return `<link type="manager" value="${m.id}">@${m.name}</link>`;
}

export function teamMention(teamId: string, name: string): string {
  return `<link type="team" value="${teamId}">@${name}</link>`;
}

export function urlLink(url: string, text?: string): string {
  return text
    ? `<link type="url" value="${url}">${text}</link>`
    : `<link type="url" value="${url}">${url}</link>`;
}

// ── 유저챗 메시지 조회 ────────────────────────────────────────────────────────

export async function fetchUserChatMessages(
  userChatId: string,
  limit = 200,
): Promise<Message[]> {
  const all: Message[] = [];
  let since: string | undefined;
  // 페이지네이션 — 안전하게 최대 5페이지
  for (let i = 0; i < 5 && all.length < limit; i++) {
    const data = await callApi<MessagesResponse>(
      `/open/v5/user-chats/${encodeURIComponent(userChatId)}/messages`,
      { query: { sortOrder: "asc", limit: 200, since } },
    );
    const msgs = data.messages || [];
    all.push(...msgs);
    if (!data.next) break;
    since = data.next;
  }
  return all.slice(0, limit);
}

// ── 메시지 발송 ────────────────────────────────────────────────────────────────

export async function sendUserChatMessage(
  userChatId: string,
  text: string,
  options: { private?: boolean; botName?: string } = {},
): Promise<{ id?: string }> {
  const path = `/open/v5/user-chats/${encodeURIComponent(userChatId)}/messages`;
  const query = options.botName ? { botName: options.botName } : {};
  const body: Record<string, unknown> = {
    blocks: [{ type: "text", value: text }],
  };
  if (options.private) body.options = ["private"];
  const res = await callApi<{ message?: { id?: string } }>(path, {
    method: "POST",
    query,
    body,
  });
  return { id: res.message?.id };
}

export async function sendInternalMemo(userChatId: string, text: string): Promise<void> {
  await sendUserChatMessage(userChatId, text, { private: true, botName: "이슈트래커" });
}

// ── 그룹(팀챗)방 메시지 ────────────────────────────────────────────────────────

export async function sendGroupMessage(
  groupId: string,
  text: string,
  rootMessageId?: string,
): Promise<{ id?: string; url?: string }> {
  const path = rootMessageId
    ? `/open/v5/groups/${groupId}/threads/${rootMessageId}/messages`
    : `/open/v4/groups/${groupId}/messages`;
  const res = await callApi<{ message?: { id?: string } }>(path, {
    method: "POST",
    body: { blocks: [{ type: "text", value: text }] },
  });
  const id = res.message?.id;
  const url = id ? `${DESK_BASE_URL}/root/groups/${groupId}/${id}` : undefined;
  return { id, url };
}

export async function fetchGroupThreadMessages(
  groupId: string,
  rootMessageId: string,
  limit = 50,
): Promise<Message[]> {
  const data = await callApi<MessagesResponse>(
    `/open/v5/groups/${groupId}/threads/${encodeURIComponent(rootMessageId)}/messages`,
    { query: { limit, sortOrder: "asc" } },
  );
  return data.messages || [];
}

// ── 유저챗 메타 ────────────────────────────────────────────────────────────────

export interface UserChatInfo {
  id: string;
  channelId: string;
  state?: string;
  userId?: string; // 고객 ID
  assigneeId?: string; // 담당 매니저 ID
  managerIds?: string[];
  name?: string;
}

export async function getUserChat(userChatId: string): Promise<UserChatInfo | null> {
  try {
    const data = await callApi<{ userChat?: UserChatInfo }>(
      `/open/v5/user-chats/${encodeURIComponent(userChatId)}`,
    );
    return data.userChat || null;
  } catch {
    return null;
  }
}

export function userChatLink(channelId: string, userChatId: string): string {
  return `${DESK_BASE_URL}/#/channels/${channelId}/user_chats/${userChatId}`;
}
