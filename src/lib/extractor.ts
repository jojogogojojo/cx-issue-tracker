/**
 * 유저챗 + 팀챗 메시지 → 이슈 정보 자동 추출 (Claude AI).
 *
 * 추출 항목:
 *  - summary: 이슈 한 줄 요약
 *  - teamChatLink: 팀챗 스레드 URL (유저챗 내부 메모에서 추출)
 *  - productManagerName: 제품팀 담당자 (팀챗 스레드 내용 기반)
 *  - followUp: 후속 안내 사항 (팀챗 스레드 보고 "고객에게 어떻게 안내해야 할지" 정리)
 */
import { createAnthropicClient, getModel } from "./anthropic";
import type { Manager, Message } from "./channeltalk";
import type Anthropic from "@anthropic-ai/sdk";

export interface ExtractedIssue {
  summary: string;
  teamChatLink: string | null;
  productManagerName: string | null;
  followUp: string | null;
}

interface BlockNode {
  type?: string;
  value?: string;
  url?: string;
  children?: BlockNode[];
  [key: string]: unknown;
}

/** 메시지 blocks에서 하이퍼링크(`<link type="url">`) URL을 모두 추출 */
function extractLinksFromBlocks(
  blocks: unknown,
): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node && typeof node === "object") {
      const b = node as BlockNode;
      if (b.type === "link" && typeof b.url === "string") {
        out.push({ text: typeof b.value === "string" ? b.value : "", url: b.url });
      }
      if (typeof b.value === "string") {
        const re = /<link\s+type="url"\s+value="([^"]+)"\s*>([^<]*)<\/link>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(b.value)) !== null) {
          out.push({ text: m[2], url: m[1] });
        }
      }
      for (const v of Object.values(b)) walk(v);
    }
  }
  walk(blocks);
  return out;
}

function formatMessagesForPrompt(messages: Message[], label: string): string {
  return messages
    .map((m) => {
      const who =
        m.personType === "manager"
          ? "매니저"
          : m.personType === "user"
            ? "고객"
            : m.personType === "bot"
              ? "봇"
              : "기타";
      const isPrivate = (m.options || []).includes("private") ? "[내부메모]" : "";
      const links = extractLinksFromBlocks(m.blocks);
      const linkSuffix = links.length
        ? `\n  [하이퍼링크: ${links.map((l) => `${l.text || "(text)"} → ${l.url}`).join(", ")}]`
        : "";
      return `[${label}/${who}]${isPrivate} ${m.plainText || "(빈 메시지)"}${linkSuffix}`;
    })
    .join("\n");
}

export async function extractIssue(
  userChatMessages: Message[],
  managers: Manager[],
  teamChatMessages?: Message[],
): Promise<ExtractedIssue> {
  if (!userChatMessages.length) {
    return {
      summary: "(빈 유저챗)",
      teamChatLink: null,
      productManagerName: null,
      followUp: null,
    };
  }
  const client = createAnthropicClient();
  const userChatFormatted = formatMessagesForPrompt(userChatMessages, "유저챗");
  const teamChatFormatted = teamChatMessages?.length
    ? formatMessagesForPrompt(teamChatMessages, "팀챗")
    : "(연결된 팀챗 스레드 없음 또는 조회 실패)";
  const managerNames = managers.map((m) => m.name).filter(Boolean).join(", ");

  const prompt = `채널톡 유저챗 + 팀챗 스레드 대화를 분석해서 이슈 정보를 JSON으로만 답하세요.

## 유저챗 대화
${userChatFormatted}

## 연결된 팀챗 스레드 (내부 논의 — 제품팀 담당자/팔로업 정보 출처)
${teamChatFormatted}

## 사내 매니저 이름 목록 (제품팀 담당자 후보)
${managerNames}

## 추출 항목
1. **summary** (필수): 이슈 한 줄 요약. 50자 이내. 고객이 겪는 문제·요청을 간결하게.
2. **teamChatLink**: 유저챗 매니저 답변/내부 메모에 언급된 팀챗 스레드 URL. 형식 예: "https://desk.channel.io/root/groups/...". 명시적으로 보이지 않으면 null.
3. **productManagerName**: **팀챗 스레드**에서 언급/멘션된 제품팀 담당자. 위 매니저 목록 중 정확히 일치하는 이름. 팀챗에서 명시되지 않으면 null. 이름 추측 금지.
4. **followUp**: 팀챗 스레드 내용 보고 "고객에게 어떤 안내를 해야 할지" 1~2문장으로 정리. 팀챗에 정보 없으면 null. 예시: "패치 일정 확정되면 안내", "기능 출시 시점에 다시 연락".

## 출력 (JSON만, 다른 텍스트·코드블럭 X)
{"summary": "...", "teamChatLink": "https://..." | null, "productManagerName": "..." | null, "followUp": "..." | null}`;

  const response = await client.messages.create({
    model: getModel(),
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`AI 응답에서 JSON 추출 실패. 원본: ${text.slice(0, 200)}`);
  }
  let parsed: {
    summary?: string;
    teamChatLink?: string | null;
    productManagerName?: string | null;
    followUp?: string | null;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`AI 응답 JSON 파싱 실패: ${(e as Error).message}\n원본: ${jsonMatch[0]}`);
  }

  return {
    summary: (parsed.summary || "(요약 미발견)").slice(0, 80),
    teamChatLink: parsed.teamChatLink || null,
    productManagerName: parsed.productManagerName || null,
    followUp: parsed.followUp || null,
  };
}

/** 팀챗 URL에서 groupId(숫자)와 rootMessageId 추출.
 *
 *  지원 형식:
 *   - https://desk.channel.io/root/groups/{name}-{id}/{messageId}   ← slug + id
 *   - https://desk.channel.io/root/groups/{id}/{messageId}           ← id만
 *   - https://channel.works/root/team-chat/groups/{id}/{messageId}   ← team-chat 경로
 *   - https://*.channel.io/root/groups/{id}/threads/{rootId}         ← threads 경로
 *
 *  groupPart의 마지막 숫자 시퀀스를 ID로 추출 ("Bug-10" → "10", "10" → "10").
 */
export function parseTeamChatUrl(
  url: string,
): { groupId: string; messageId: string } | null {
  if (!url) return null;
  const extractNumericId = (part: string): string => {
    const decoded = decodeURIComponent(part);
    // 마지막 숫자 시퀀스 추출 (slug-id 형식 대응)
    const tail = decoded.match(/(\d+)$/);
    return tail ? tail[1] : decoded;
  };

  // groups/{groupPart}/threads/{rootId}
  let m = url.match(/\/groups\/([^/]+)\/threads\/([a-zA-Z0-9-]+)/);
  if (m) return { groupId: extractNumericId(m[1]), messageId: m[2] };
  // groups/{groupPart}/{messageId}
  m = url.match(/\/groups\/([^/]+)\/([a-zA-Z0-9-]+)(?:[/?#]|$)/);
  if (m) return { groupId: extractNumericId(m[1]), messageId: m[2] };
  return null;
}
