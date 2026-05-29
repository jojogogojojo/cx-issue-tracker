/**
 * 답글 폴링 — GitHub Actions cron이 5분마다 호출.
 * 인증: Authorization: Bearer ${TRIGGER_SECRET}
 */
import { Controller, Post, Get, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { fetchGroupThreadMessages } from './lib/channeltalk';
import { listOpenEvents, processReply } from './lib/alert';

function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

@Controller('api/poll-replies')
export class PollRepliesController {
  @Get()
  info() {
    return { status: 'ok', message: '답글 폴링 엔드포인트 — POST + Bearer auth 필요' };
  }

  @Post()
  async pollReplies(@Headers('authorization') authHeader: string) {
    const triggerSecret = process.env.TRIGGER_SECRET;
    if (!triggerSecret) {
      throw new HttpException('TRIGGER_SECRET 미설정', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const token = (authHeader || '').replace(/^Bearer\s+/i, '');
    if (token !== triggerSecret) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const today = getTodayKst();

    let events;
    try {
      events = await listOpenEvents(today, 14);
    } catch (e) {
      throw new HttpException(
        `캘린더 조회 실패: ${e instanceof Error ? e.message : String(e)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const targets = events.filter(
      (ev) =>
        ev.summary.startsWith('⬜') &&
        ev.extProps.alertMessageId &&
        ev.extProps.alertGroupId,
    );

    const summary: Array<{ eventId: string; processed: number; error?: string }> = [];

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
        const candidates = replies.filter(
          (m) => m.id !== rootId && m.createdAt > alertSentAt && m.personType !== 'bot',
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

    return {
      ok: true,
      today,
      targetsCount: targets.length,
      totalProcessed: summary.reduce((acc, s) => acc + s.processed, 0),
      perEvent: summary,
    };
  }
}
