import { fetchTenantAccessToken } from '../feishuBotHttp.js';

const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

type UploadCardVideoSummary = {
  status: 'success' | 'failure';
  cacheKey: string;
  videoUrl: string;
  fileKey?: string;
  errorMessage?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumberEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

async function downloadVideo(videoUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(videoUrl, {
    headers: {
      accept: 'video/*,*/*;q=0.8',
      'user-agent': 'xarticle2feishu-card-video/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Downloaded video is empty');
  }
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`Video exceeds 30MB limit: ${bytes.byteLength} bytes`);
  }

  const pathname = new URL(videoUrl).pathname.toLowerCase();
  const looksMp4 = pathname.endsWith('.mp4') || contentType.toLowerCase().includes('mp4');
  if (!looksMp4) {
    throw new Error(`Unsupported video type for Feishu card upload: ${contentType}`);
  }

  return { bytes, contentType };
}

async function uploadMp4ToFeishu(input: {
  tenantAccessToken: string;
  fileBytes: Uint8Array;
  durationMs: number | null;
  fileName: string;
}): Promise<string> {
  const formData = new FormData();
  formData.set('file_type', 'mp4');
  formData.set('file_name', input.fileName);
  if (input.durationMs !== null) {
    formData.set('duration', String(input.durationMs));
  }
  formData.set(
    'file',
    new File([Buffer.from(input.fileBytes)], input.fileName, { type: 'video/mp4' }),
  );

  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.tenantAccessToken}`,
    },
    body: formData,
  });

  const payload = await response.json() as {
    code?: number;
    msg?: string;
    data?: { file_key?: string };
  };

  if (!response.ok || payload.code !== 0 || !payload.data?.file_key) {
    throw new Error(`Feishu file upload failed: ${response.status} ${payload.msg ?? JSON.stringify(payload)}`);
  }

  return payload.data.file_key;
}

async function notifyCallback(summary: UploadCardVideoSummary): Promise<void> {
  const callbackUrl = requiredEnv('CALLBACK_URL');
  const callbackToken = requiredEnv('CALLBACK_TOKEN');

  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${callbackToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      status: summary.status === 'success' ? 'success' : 'failure',
      cacheKey: summary.cacheKey,
      fileKey: summary.fileKey,
      error: summary.errorMessage,
      videoUrl: summary.videoUrl,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Callback failed: ${response.status} ${text}`);
  }
}

async function main(): Promise<void> {
  const videoUrl = requiredEnv('VIDEO_URL');
  const cacheKey = process.env.CACHE_KEY?.trim() || videoUrl;
  const durationMs = optionalNumberEnv('DURATION_MS');
  const appId = requiredEnv('FEISHU_BOT_APP_ID');
  const appSecret = requiredEnv('FEISHU_BOT_APP_SECRET');

  let summary: UploadCardVideoSummary;

  try {
    const { bytes } = await downloadVideo(videoUrl);
    const { tenantAccessToken } = await fetchTenantAccessToken(appId, appSecret);
    const fileKey = await uploadMp4ToFeishu({
      tenantAccessToken,
      fileBytes: bytes,
      durationMs,
      fileName: 'card-video.mp4',
    });

    summary = {
      status: 'success',
      cacheKey,
      videoUrl,
      fileKey,
    };
  } catch (error) {
    summary = {
      status: 'failure',
      cacheKey,
      videoUrl,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await notifyCallback(summary);
  } catch (notifyError) {
    console.warn(notifyError instanceof Error ? notifyError.message : String(notifyError));
  }

  console.log(JSON.stringify(summary));

  if (summary.status === 'failure') {
    throw new Error(summary.errorMessage ?? 'video upload failed');
  }
}

await main();
