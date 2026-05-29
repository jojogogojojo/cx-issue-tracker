/**
 * 채널톡 앱 커맨드 핸들러 — PUT /functions/:version
 *
 * 흐름:
 *  1. (즉시) "🔄 등록 중..." 내부 메모 발송
 *  2. (즉시) 채널톡에 빠른 응답 → timeout 방지
 *  3. (백그라운드) AI 분석 + 캘린더 등록 + "✅ 완료" 내부 메모 발송
 */
import { Controller, Put, Get, Param, Body } from '@nestjs/common';
import {
  fetchUserChatMessages,
  fetchGroupThreadMessages,
  findManager,
  getManagers,
  getUserChat,
  sendInternalMemo,
  urlLink,
  userChatLink,
  type Manager,
  type Message,
} from './lib/channeltalk';
import { extractIssue, parseTeamChatUrl } from './lib/extractor';
import { createIssueEvent } from './lib/google-calendar';

interface CommandPayload {
  method?: string;
  chat?: { id?: string; type?: string };
  input?: { date?: string };
  params?: {
    chat?: { id?: string; type?: string };
    input?: { date?: string };
  };
  context?: {
    caller?: { id?: string; type?: string };
    channel?: { id?: string };
  };
}

function defaultTrackingDateKst(offsetDays = 2): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().slice(0, 10);
}

function formatDateWithWeekday(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00+09:00`);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${yyyyMmDd}(${weekdays[d.getUTCDay()]})`;
}

function stringResp(message: string) {
  return { result: { type: 'string', attributes: { message } } };
}

@Controller('functions')
export class FunctionsController {
  @Get()
  healthCheck() {
    return { status: 'ok', message: '이슈트래커 커맨드 핸들러 — PUT /functions/:version' };
  }

  @Put(':version')
  async handleCommand(@Param('version') _version: string, @Body() body: CommandPayload) {
    // getFunctions: 채널톡이 앱 등록 시 호출 — 사용 가능한 함수 목록 반환
    if (body.method === 'getFunctions' || body.method === 'extension.core.function.getFunctions') {
      return { result: [{ name: 'issuetracker' }] };
    }

    const chatId = body.chat?.id ?? body.params?.chat?.id;
    const chatType = body.chat?.type ?? body.params?.chat?.type;
    const callerId = body.context?.caller?.id ?? '';
    const channelId = body.context?.channel?.id ?? '';

    let trackingDate = body.input?.date ?? body.params?.input?.date ?? '';
    if (!trackingDate || !/^\d{4}-\d{2}-\d{2}$/.test(trackingDate)) {
      trackingDate = defaultTrackingDateKst(2);
    }

    if (!chatId) {
      return stringResp('⚠️ chat.id 누락.');
    }
    if (chatType !== 'userChat') {
      return stringResp(`⚠️ 유저챗에서만 호출 가능합니다 (현재: ${chatType || 'unknown'}).`);
    }

    const trackingDateLabel = formatDateWithWeekday(trackingDate);
    void (async () => {
      try {
        await sendInternalMemo(chatId, `🔄 이슈 등록 중... (트래킹 날짜: ${trackingDateLabel})`);
      } catch (e) {
        console.error('[command] 처리중 내부메모 발송 실패:', e);
      }
      try {
        await runBackgroundProcessing({ chatId, callerId, channelId, trackingDate });
      } catch (err) {
        console.error('[command] 백그라운드 처리 실패:', err);
        await sendInternalMemo(
          chatId,
          `❌ 이슈 등록 실패: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    })();

    return stringResp('🔄 이슈 등록 시작했어요. 결과는 내부 메모로 알려드릴게요.');
  }
}

async function runBackgroundProcessing(args: {
  chatId: string;
  callerId: string;
  channelId: string;
  trackingDate: string;
}) {
  const { chatId, callerId, channelId, trackingDate } = args;

  const managerCache = await getManagers();

  const [messages, userChat] = await Promise.all([
    fetchUserChatMessages(chatId, 200),
    getUserChat(chatId),
  ]);

  const cxManager = await resolveCxManager({
    callerId,
    assigneeId: userChat?.assigneeId,
    messages,
    managerCache,
  });

  const firstPass = await extractIssue(messages, managerCache.list);
  let teamChatMessages: Message[] | undefined;
  let teamChatLink = firstPass.teamChatLink;

  if (teamChatLink) {
    const parsed = parseTeamChatUrl(teamChatLink);
    if (parsed) {
      try {
        teamChatMessages = await fetchGroupThreadMessages(
          parsed.groupId,
          parsed.messageId,
          100,
        );
      } catch (e) {
        console.error('[command] 팀챗 스레드 조회 실패:', e);
      }
    }
  }

  const extracted = teamChatMessages
    ? await extractIssue(messages, managerCache.list, teamChatMessages)
    : firstPass;
  teamChatLink = extracted.teamChatLink || teamChatLink;

  const productManager = extracted.productManagerName
    ? managerCache.byName.get(extracted.productManagerName) ?? null
    : null;

  const channel = channelId || userChat?.channelId || '';
  const ucLink = channel ? userChatLink(channel, chatId) : '';
  const cxName = cxManager?.name || '(미상 — 매니저 매칭 실패)';
  const pmName =
    productManager?.name ||
    (extracted.productManagerName
      ? `${extracted.productManagerName} (매칭 실패)`
      : '(미발견 — 유저챗 또는 연관 팀챗에서 찾기)');

  const linkItems: string[] = [];
  if (ucLink) linkItems.push(`* <a href="${ucLink}">유저챗 링크</a>`);
  if (teamChatLink) linkItems.push(`* <a href="${teamChatLink}">연관 팀챗 링크</a>`);
  if (linkItems.length === 0) linkItems.push('* (링크 없음)');

  const descLines = [
    `◾️ 이슈 요약`,
    extracted.summary,
    ``,
    `◾️ 팔로업`,
    extracted.followUp || '(미발견 — 유저챗 또는 연관 팀챗 확인 후 보강)',
    ``,
    `◾️ 담당자: ${cxName}`,
    `◾️ 제품팀 담당자: ${pmName}`,
    ``,
    `◾️ 관련 링크`,
    ...linkItems,
  ];

  const event = await createIssueEvent({
    summary: `⬜ ${extracted.summary}`,
    description: descLines.join('\n'),
    date: trackingDate,
  });

  const missing: string[] = [];
  if (!teamChatLink) missing.push('팀챗 링크');
  if (!productManager) missing.push('제품팀 담당자');
  if (!cxManager) missing.push('CX 담당자');
  if (!extracted.followUp) missing.push('팔로업 내용');

  const calLink = urlLink(event.htmlLink, '캘린더 확인하기');
  const completionLines = [`✅ ${formatDateWithWeekday(trackingDate)} 등록 완료 ${calLink}`];
  if (missing.length > 0) {
    completionLines.push(
      `🔴 ${missing.join(', ')}을(를) 찾지 못했어요. 캘린더에 직접 추가해 주세요.`,
    );
  }

  await sendInternalMemo(chatId, completionLines.join('\n'));
}

async function resolveCxManager(args: {
  callerId: string;
  assigneeId?: string;
  messages: Message[];
  managerCache: { list: Manager[]; byId: Map<string, Manager> };
}): Promise<Manager | null> {
  const { callerId, assigneeId, messages, managerCache } = args;

  if (callerId) {
    const m = managerCache.byId.get(callerId) ?? (await findManager(callerId));
    if (m) return m;
  }
  if (assigneeId) {
    const m = managerCache.byId.get(assigneeId) ?? (await findManager(assigneeId));
    if (m) return m;
  }
  const recentMgrMsg = [...messages]
    .reverse()
    .find((mm) => mm.personType === 'manager' && mm.personId);
  if (recentMgrMsg?.personId) {
    const m =
      managerCache.byId.get(recentMgrMsg.personId) ?? (await findManager(recentMgrMsg.personId));
    if (m) return m;
  }
  return null;
}
