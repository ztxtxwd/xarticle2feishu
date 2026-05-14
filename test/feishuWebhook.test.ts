import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFeishuWebhookMessage } from '../src/feishuWebhook.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendFeishuWebhookMessage', () => {
  it('sends a text webhook message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendFeishuWebhookMessage({
      webhookUrl: 'https://example.com/hook',
      title: 'X article conversion succeeded',
      lines: ['articleUrl: https://x.com/demo/status/1', 'docUrl: https://docs.feishu.cn/docx/abc'],
    });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: 'X article conversion succeeded\narticleUrl: https://x.com/demo/status/1\ndocUrl: https://docs.feishu.cn/docx/abc',
        },
      }),
    });
  });

  it('throws when webhook delivery fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 19024, msg: 'invalid webhook' }),
    }));

    await expect(sendFeishuWebhookMessage({
      webhookUrl: 'https://example.com/hook',
      title: 'failed',
      lines: ['error: test'],
    })).rejects.toThrow('Failed to send Feishu webhook message');
  });
});
