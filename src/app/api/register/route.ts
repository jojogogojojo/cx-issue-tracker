/**
 * 이슈 등록 API — WAM이 트래킹 날짜를 받아서 호출.
 * 1. 호출자(CX 담당) 정보 조회
 * 2. 매니저 목록 캐시 (이름 매핑용)
 * 3. 유저챗 메시지 가져오기
 * 4. Claude AI로 이슈 요약 / 팀챗 링크 / 제품팀 담당자 추출
 * 5. Google Calendar에 종일 이벤트 생성 (`⬜ [요약]`)
 * 6. AI가 못 찾은 항목 있으면 유저챗 내부 메모로 보강 요청 자동 발송
 * 7. WAM에 결과 응답 (등록된 정보 + 미발견 항목 표시)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  fetchUserChatMessages,
  findManager,
  getManagers,
  getUserChat,
  sendInternalMemo,
  urlLink,
  userChatLink,
} from "@/lib/channeltalk";
import { extractIssue } from "@/lib/extractor";
import { createIssueEvent } from "@/lib/google-calendar";

const RequestSchema = z.object({
  chatId: z.string().min(1),
  callerId: z.string().min(1),
  channelId: z.string().optional(),
  trackingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "입력값 오류", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { chatId, callerId, channelId, trackingDate } = parsed.data;

  try {
    // 1. 호출자(CX 담당) 매니저 정보
    const caller = await findManager(callerId);

    // 2. 매니저 목록 캐시
    const managerCache = await getManagers();

    // 3. 유저챗 메시지 + 메타
    const [messages, userChat] = await Promise.all([
      fetchUserChatMessages(chatId, 200),
      getUserChat(chatId),
    ]);

    // 4. AI 추출
    const extracted = await extractIssue(messages, managerCache.list);

    // 5. 제품팀 담당자 매핑
    const productManager = extracted.productManagerName
      ? managerCache.byName.get(extracted.productManagerName) ?? null
      : null;

    // 6. 캘린더 이벤트 생성
    const channel = channelId || userChat?.channelId || "";
    const ucLink = channel ? userChatLink(channel, chatId) : "";

    const teamChatLine = extracted.teamChatLink
      ? `팀챗: ${extracted.teamChatLink}`
      : `팀챗: (미발견 — 확인 필요)`;
    const cxLine = caller
      ? `CX 담당: ${caller.name}${caller.email ? ` <${caller.email}>` : ""}`
      : `CX 담당: ${callerId} (조회 실패)`;
    const pmLine = productManager
      ? `제품팀 담당: ${productManager.name}${productManager.email ? ` <${productManager.email}>` : ""}`
      : extracted.productManagerName
        ? `제품팀 담당: ${extracted.productManagerName} (매니저 매칭 실패 — 확인 필요)`
        : `제품팀 담당: (미발견 — 확인 필요)`;
    const ucLine = ucLink ? `유저챗: ${ucLink}` : "유저챗: (링크 생성 실패)";

    const description = [ucLine, teamChatLine, cxLine, pmLine].join("\n");

    const event = await createIssueEvent({
      summary: `⬜ ${extracted.summary}`,
      description,
      date: trackingDate,
    });

    // 7. AI 미발견 항목이 있으면 내부 메모로 보강 요청
    const missing: string[] = [];
    if (!extracted.teamChatLink) missing.push("연관 이슈 링크");
    if (!productManager) missing.push("제품팀 담당자");

    if (missing.length > 0) {
      const calendarLink = urlLink(event.htmlLink, "캘린더");
      const missingText = missing.join(", ");
      try {
        await sendInternalMemo(
          chatId,
          `${missingText}을(를) 찾지 못했어요. ${calendarLink}에 직접 추가해 주세요.`,
        );
      } catch (memoErr) {
        console.error("[register] 내부 메모 발송 실패:", memoErr);
        // 메모 실패해도 일정 등록은 성공이므로 무시하고 응답
      }
    }

    return NextResponse.json({
      ok: true,
      event: {
        id: event.id,
        link: event.htmlLink,
        date: trackingDate,
        summary: extracted.summary,
      },
      extracted: {
        summary: extracted.summary,
        teamChatLink: extracted.teamChatLink,
        productManager: productManager
          ? { name: productManager.name, email: productManager.email }
          : null,
        productManagerNameRaw: extracted.productManagerName,
      },
      caller: caller ? { name: caller.name, email: caller.email } : null,
      missing,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[register] 처리 실패:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
