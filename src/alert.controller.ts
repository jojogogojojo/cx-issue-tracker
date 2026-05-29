/**
 * D-2 알림 발송 — GitHub Actions cron이 매일 한 번 호출.
 * 인증: Authorization: Bearer ${TRIGGER_SECRET}
 */
import { Controller, Post, Get, Headers, HttpException, HttpStatus } from '@nestjs/common';
import {
  buildAlertMessage,
  isAlertDay,
  listOpenEvents,
  patchEventExtProps,
  type IssueEventFull,
} from './lib/alert';
import { findManager, sendGroupMessage } from './lib/channeltalk';

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
    if (line.startsWith('유저챗:')) {
      const url = line.replace(/^유저챗:\s*/, '');
      if (url.startsWith('http')) out.userChatLink = url;
    } else if (line.startsWith('팀챗:')) {
      const url = line.replace(/^팀챗:\s*/, '');
      if (url.startsWith('http')) out.teamChatLink = url;
    } else if (line.startsWith('CX 담당:')) {
      const m = line.replace(/^CX 담당:\s*/, '').match(/^([^<\s]+)/);
      if (m) out.cxName = m[1];
    } else if (line.startsWith('제품팀 담당:')) {
      const m = line.replace(/^제품팀 담당:\s*/, '').match(/^([^<\s]+)/);
      if (m) out.pmName = m[1];
    }
  }
  return out;
}

@Controller('api/alert')
export class AlertController {
  @Get()
  info() {
    return { status: 'ok', message: 'D-2 알림 엔드포인트 — POST + Bearer auth 필요' };
  }

  @Post()
  async runAlert(@Headers('authorization') authHeader: string) {
    const triggerSecret = process.env.TRIGGER_SECRET;
    if (!triggerSecret) {
      throw new HttpException('TRIGGER_SECRET 미설정', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const token = (authHeader || '').replace(/^Bearer\s+/i, '');
    if (token !== triggerSecret) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const groupId = process.env.ISSUE_TRACKER_ALERT_GROUP_ID || '356599';
    const today = getTodayKst();

    let events: IssueEventFull[];
    try {
      events = await listOpenEvents(today, 14);
    } catch (e) {
      throw new HttpException(
        `캘린더 조회 실패: ${e instanceof Error ? e.message : String(e)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const candidates = events.filter((ev) => {
      if (!ev.summary.startsWith('⬜')) return false;
      if (ev.extProps.alertMessageId) return false;
      return isAlertDay(today, ev.date);
    });

    const results: Array<{ eventId: string; status: 'sent' | 'error'; error?: string }> = [];

    for (const ev of candidates) {
      try {
        const summary = ev.summary.replace(/^⬜\s*/, '');
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
            status: 'open',
          });
          results.push({ eventId: ev.id, status: 'sent' });
        } else {
          results.push({ eventId: ev.id, status: 'error', error: '메시지 ID 없음' });
        }
      } catch (e) {
        results.push({
          eventId: ev.id,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      ok: true,
      today,
      groupId,
      candidatesCount: candidates.length,
      sent: results.filter((r) => r.status === 'sent').length,
      errors: results.filter((r) => r.status === 'error'),
    };
  }
}
