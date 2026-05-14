import type { FeishuWebhookMessageInput } from './types.js';

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendFeishuWebhookMessage(input: FeishuWebhookMessageInput): Promise<void> {
  const text = [input.title, ...input.lines].map((line) => escapeText(line)).join('\n');

  const response = await fetch(input.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text,
      },
    }),
  });

  const payload = await response.json() as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };
  const successCode = payload.code ?? payload.StatusCode ?? 0;
  if (!response.ok || successCode !== 0) {
    throw new Error(`Failed to send Feishu webhook message: ${JSON.stringify(payload)}`);
  }
}
