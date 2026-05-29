import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Prism 등 멀티 프로바이더 게이트웨이 사용 시 "anthropic/" 프리픽스 자동 추가.
 * `ANTHROPIC_API_BASE_URL`이 설정돼 있으면 프록시 경유로 간주.
 */
export function getModel(): string {
  if (process.env.ANTHROPIC_API_BASE_URL) {
    return `anthropic/${DEFAULT_MODEL}`;
  }
  return DEFAULT_MODEL;
}

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다");
  }
  const options: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
  if (process.env.ANTHROPIC_API_BASE_URL) {
    options.baseURL = process.env.ANTHROPIC_API_BASE_URL;
  }
  return new Anthropic(options);
}
