import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTenantAccessToken, uploadFileToDocument } from '../src/feishuBotHttp.js';

const uploadInputBase = {
  documentId: 'doc-token',
  blockId: 'block-token',
  fileName: 'video.mp4',
  botTenantAccessToken: 'tenant-token',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTenantAccessToken', () => {
  it('fetches tenant access token with app credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'ok', tenant_access_token: 'tenant-token', expire: 7200 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTenantAccessToken('cli_app', 'secret');

    expect(result).toEqual({ tenantAccessToken: 'tenant-token', expire: 7200 });
    expect(fetchMock).toHaveBeenCalledWith('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: 'cli_app',
        app_secret: 'secret',
      }),
    });
  });

  it('throws when tenant access token fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 99991663, msg: 'invalid app secret' }),
    }));

    await expect(fetchTenantAccessToken('cli_app', 'bad-secret')).rejects.toThrow('Failed to fetch tenant access token');
  });
});

describe('uploadFileToDocument', () => {
  it('uses upload_all for files up to 20MB', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'ok', data: { file_token: 'file-token-small' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const fileBytes = new Uint8Array(20 * 1024 * 1024);
    const result = await uploadFileToDocument({
      ...uploadInputBase,
      fileBytes,
    });

    expect(result).toEqual({ fileToken: 'file-token-small' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: 'Bearer tenant-token' });
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('uses multipart upload for files over 20MB', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: 'ok',
          data: {
            upload_id: 'upload-123',
            block_size: 20971520,
            block_num: 2,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: 'ok' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: 'ok' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: 'ok', data: { file_token: 'file-token-large' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const fileBytes = new Uint8Array((20 * 1024 * 1024) + 1);
    fileBytes.set([1, 2, 3, 4, 5, 6, 7, 8, 9], 0);

    const result = await uploadFileToDocument({
      ...uploadInputBase,
      fileBytes,
    });

    expect(result).toEqual({ fileToken: 'file-token-large' });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://open.feishu.cn/open-apis/drive/v1/medias/upload_prepare');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://open.feishu.cn/open-apis/drive/v1/medias/upload_part');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://open.feishu.cn/open-apis/drive/v1/medias/upload_part');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('https://open.feishu.cn/open-apis/drive/v1/medias/upload_finish');

    const prepareInit = fetchMock.mock.calls[0]?.[1];
    expect(prepareInit?.headers).toEqual({
      Authorization: 'Bearer tenant-token',
      'Content-Type': 'application/json; charset=utf-8',
    });
    expect(JSON.parse(String(prepareInit?.body))).toEqual({
      file_name: 'video.mp4',
      parent_type: 'docx_file',
      parent_node: 'block-token',
      size: fileBytes.byteLength,
      extra: '{"drive_route_token":"doc-token"}',
    });

    const part1 = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const part2 = fetchMock.mock.calls[2]?.[1]?.body as FormData;

    expect(part1.get('upload_id')).toBe('upload-123');
    expect(part1.get('seq')).toBe('0');
    expect(part1.get('size')).toBe('20971520');

    expect(part2.get('seq')).toBe('1');
    expect(part2.get('size')).toBe('1');

    const finishInit = fetchMock.mock.calls[3]?.[1];
    expect(JSON.parse(String(finishInit?.body))).toEqual({
      upload_id: 'upload-123',
      block_num: 2,
    });
  });
});
