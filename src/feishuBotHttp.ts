import type {
  FeishuBotInfo,
  FeishuMediaUploadInput,
  FeishuMediaUploadResult,
  FeishuMultipartUploadPrepareResult,
} from './types.js';

const FEISHU_UPLOAD_ALL_LIMIT_BYTES = 20 * 1024 * 1024;
const ADLER32_MOD = 65521;

type FeishuUploadPayload = {
  code: number;
  data?: {
    file_token?: string;
  };
  msg: string;
};

type FeishuMultipartPreparePayload = {
  code: number;
  data?: {
    upload_id?: string;
    block_size?: number;
    block_num?: number;
  };
  msg: string;
};

function authorizationHeader(botTenantAccessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${botTenantAccessToken}`,
  };
}

function adler32(bytes: Uint8Array): string {
  let a = 1;
  let b = 0;

  for (const byte of bytes) {
    a = (a + byte) % ADLER32_MOD;
    b = (b + a) % ADLER32_MOD;
  }

  return String(((b << 16) | a) >>> 0);
}

function uploadMetadata(input: FeishuMediaUploadInput, parentType: 'docx_image' | 'docx_file') {
  return {
    file_name: input.fileName,
    parent_type: parentType,
    parent_node: input.blockId,
    size: input.fileBytes.byteLength,
    extra: JSON.stringify({ drive_route_token: input.documentId }),
  };
}

function parseUploadPayload(payload: FeishuUploadPayload): FeishuMediaUploadResult {
  if (payload.code !== 0 || !payload.data?.file_token) {
    throw new Error(`Failed to upload media: ${JSON.stringify(payload)}`);
  }

  return { fileToken: payload.data.file_token };
}

function parseMultipartPreparePayload(payload: FeishuMultipartPreparePayload): FeishuMultipartUploadPrepareResult {
  const uploadId = payload.data?.upload_id;
  const blockSize = payload.data?.block_size;
  const blockNum = payload.data?.block_num;

  if (payload.code !== 0 || !uploadId || typeof blockSize !== 'number' || typeof blockNum !== 'number') {
    throw new Error(`Failed to prepare multipart upload: ${JSON.stringify(payload)}`);
  }

  return {
    uploadId,
    blockSize,
    blockNum,
  };
}

export async function fetchBotInfo(botTenantAccessToken: string): Promise<FeishuBotInfo> {
  const response = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
    headers: authorizationHeader(botTenantAccessToken),
  });

  const payload = await response.json() as { code: number; bot?: { open_id?: string }; msg: string };
  if (!response.ok || payload.code !== 0 || !payload.bot?.open_id) {
    throw new Error(`Failed to fetch bot info: ${JSON.stringify(payload)}`);
  }

  return { openId: payload.bot.open_id };
}

async function uploadAll(input: FeishuMediaUploadInput, parentType: 'docx_image' | 'docx_file'): Promise<FeishuMediaUploadResult> {
  const form = new FormData();
  const metadata = uploadMetadata(input, parentType);
  form.set('file_name', metadata.file_name);
  form.set('parent_type', metadata.parent_type);
  form.set('parent_node', metadata.parent_node);
  form.set('size', String(metadata.size));
  form.set('extra', metadata.extra);
  form.set('checksum', adler32(input.fileBytes));
  const bytes = new Uint8Array(input.fileBytes).slice();
  form.set('file', new Blob([bytes.buffer]), input.fileName);

  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
    method: 'POST',
    headers: authorizationHeader(input.botTenantAccessToken),
    body: form,
  });

  const payload = await response.json() as FeishuUploadPayload;
  if (!response.ok) {
    throw new Error(`Failed to upload media: ${JSON.stringify(payload)}`);
  }

  return parseUploadPayload(payload);
}

async function prepareMultipartMediaUpload(
  input: FeishuMediaUploadInput,
  parentType: 'docx_file',
): Promise<FeishuMultipartUploadPrepareResult> {
  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_prepare', {
    method: 'POST',
    headers: {
      ...authorizationHeader(input.botTenantAccessToken),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(uploadMetadata(input, parentType)),
  });

  const payload = await response.json() as FeishuMultipartPreparePayload;
  if (!response.ok) {
    throw new Error(`Failed to prepare multipart upload: ${JSON.stringify(payload)}`);
  }

  return parseMultipartPreparePayload(payload);
}

async function uploadMultipartMediaPart(
  botTenantAccessToken: string,
  uploadId: string,
  seq: number,
  partBytes: Uint8Array,
): Promise<void> {
  const form = new FormData();
  form.set('upload_id', uploadId);
  form.set('seq', String(seq));
  form.set('size', String(partBytes.byteLength));
  form.set('checksum', adler32(partBytes));
  const partBuffer = new Uint8Array(partBytes).slice();
  form.set('file', new Blob([partBuffer.buffer]), `part-${seq}`);

  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_part', {
    method: 'POST',
    headers: authorizationHeader(botTenantAccessToken),
    body: form,
  });

  const payload = await response.json() as { code: number; msg: string };
  if (!response.ok || payload.code !== 0) {
    throw new Error(`Failed to upload media part: ${JSON.stringify(payload)}`);
  }
}

async function finishMultipartMediaUpload(
  botTenantAccessToken: string,
  uploadId: string,
  blockNum: number,
): Promise<FeishuMediaUploadResult> {
  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_finish', {
    method: 'POST',
    headers: {
      ...authorizationHeader(botTenantAccessToken),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      upload_id: uploadId,
      block_num: blockNum,
    }),
  });

  const payload = await response.json() as FeishuUploadPayload;
  if (!response.ok) {
    throw new Error(`Failed to finish multipart upload: ${JSON.stringify(payload)}`);
  }

  return parseUploadPayload(payload);
}

async function uploadMultipartFileToDocument(input: FeishuMediaUploadInput): Promise<FeishuMediaUploadResult> {
  const prepared = await prepareMultipartMediaUpload(input, 'docx_file');

  for (let seq = 0; seq < prepared.blockNum; seq += 1) {
    const start = seq * prepared.blockSize;
    const end = Math.min(start + prepared.blockSize, input.fileBytes.byteLength);
    const partBytes = input.fileBytes.slice(start, end);
    await uploadMultipartMediaPart(input.botTenantAccessToken, prepared.uploadId, seq, partBytes);
  }

  return finishMultipartMediaUpload(input.botTenantAccessToken, prepared.uploadId, prepared.blockNum);
}

export async function uploadImageToDocument(input: FeishuMediaUploadInput): Promise<FeishuMediaUploadResult> {
  return uploadAll(input, 'docx_image');
}

export async function uploadFileToDocument(input: FeishuMediaUploadInput): Promise<FeishuMediaUploadResult> {
  if (input.fileBytes.byteLength <= FEISHU_UPLOAD_ALL_LIMIT_BYTES) {
    return uploadAll(input, 'docx_file');
  }

  return uploadMultipartFileToDocument(input);
}
