import type {
  FeishuBlockIdRelation,
  FeishuDescendantRequest,
} from './types.js';

const DOC_URL_BASE = 'https://li.feishu.cn/docx/';
const OPEN_API_BASE = 'https://open.feishu.cn/open-apis';

type FeishuApiPayload<T = Record<string, unknown>> = {
  code: number;
  msg?: string;
  data?: T;
};

export type FeishuBlockSummary = {
  blockId: string;
  parentId?: string;
  children: string[];
};

export type DocxDocumentRef = {
  documentId: string;
  docUrl: string;
};

export type CreateDocxDocumentInput = {
  title: string;
  botTenantAccessToken: string;
};

export type ListDocxBlocksInput = {
  documentId: string;
  pageToken?: string;
  botTenantAccessToken: string;
};

export type ListDocxBlocksResult = {
  items: FeishuBlockSummary[];
  pageToken?: string;
};

export type BatchDeleteDocxBlockChildrenInput = {
  documentId: string;
  blockId: string;
  startIndex: number;
  endIndex: number;
  botTenantAccessToken: string;
};

export type CreateDocxDescendantBlocksInput = {
  documentId: string;
  blockId: string;
  request: FeishuDescendantRequest;
  botTenantAccessToken: string;
};

export type PatchDocxBlockInput = {
  documentId: string;
  blockId: string;
  body: Record<string, unknown>;
  botTenantAccessToken: string;
};

export type TransferDocumentOwnerInput = {
  documentId: string;
  ownerOpenId: string;
  botTenantAccessToken: string;
};

export type ClearDocxRootChildrenInput = {
  documentId: string;
  botTenantAccessToken: string;
};

function authorizationHeader(botTenantAccessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${botTenantAccessToken}`,
  };
}

function jsonHeaders(botTenantAccessToken: string): Record<string, string> {
  return {
    ...authorizationHeader(botTenantAccessToken),
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function ensureSuccess(operation: string, response: Response, payload: FeishuApiPayload): void {
  if (!response.ok || payload.code !== 0) {
    throw new Error(`Failed to ${operation}: ${JSON.stringify(payload)}`);
  }
}

function normalizeDocUrl(documentId: string): string {
  return `${DOC_URL_BASE}${documentId}`;
}

function parseDocumentId(docUrl: string): string {
  let url: URL;
  try {
    url = new URL(docUrl);
  } catch {
    throw new Error(`Invalid Feishu document URL: ${docUrl}`);
  }

  const match = url.pathname.match(/^\/docx\/([^/]+)\/?$/);
  const documentId = match?.[1];
  if (!documentId) {
    throw new Error(`Invalid Feishu document URL: ${docUrl}`);
  }

  return documentId;
}

function parseBlockSummaries(data: Record<string, unknown> | undefined): ListDocxBlocksResult {
  const safeData = data ?? {};
  const items = Array.isArray(safeData.items) ? safeData.items : [];
  const pageToken = typeof safeData.page_token === 'string' && safeData.page_token ? safeData.page_token : undefined;

  return {
    items: items.map((item) => {
      const block = item as Record<string, unknown>;
      const children = Array.isArray(block.children)
        ? block.children.filter((child): child is string => typeof child === 'string')
        : [];
      const parentId = typeof block.parent_id === 'string' && block.parent_id ? block.parent_id : undefined;
      return {
        blockId: String(block.block_id),
        parentId,
        children,
      };
    }),
    pageToken,
  };
}

export function resolveDocxDocumentFromUrl(docUrl: string): DocxDocumentRef {
  const documentId = parseDocumentId(docUrl);
  return { documentId, docUrl: normalizeDocUrl(documentId) };
}

export async function createDocxDocument(input: CreateDocxDocumentInput): Promise<DocxDocumentRef> {
  const response = await fetch(`${OPEN_API_BASE}/docx/v1/documents`, {
    method: 'POST',
    headers: jsonHeaders(input.botTenantAccessToken),
    body: JSON.stringify({ title: input.title }),
  });

  const payload = (await response.json()) as FeishuApiPayload<{ document?: { document_id?: string } }>;
  ensureSuccess('create document', response, payload);

  const documentId = payload.data?.document?.document_id;
  if (!documentId) {
    throw new Error(`Create document response missing document_id: ${JSON.stringify(payload)}`);
  }

  return { documentId, docUrl: normalizeDocUrl(documentId) };
}

export async function listDocxBlocks(input: ListDocxBlocksInput): Promise<ListDocxBlocksResult> {
  const url = new URL(`${OPEN_API_BASE}/docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks`);
  url.searchParams.set('page_size', '500');
  if (input.pageToken) {
    url.searchParams.set('page_token', input.pageToken);
  }

  const response = await fetch(url, {
    headers: authorizationHeader(input.botTenantAccessToken),
  });

  const payload = (await response.json()) as FeishuApiPayload;
  ensureSuccess('list document blocks', response, payload);

  return parseBlockSummaries(payload.data);
}

export async function batchDeleteDocxBlockChildren(input: BatchDeleteDocxBlockChildrenInput): Promise<void> {
  const url = `${OPEN_API_BASE}/docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks/${encodeURIComponent(input.blockId)}/children/batch_delete`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: jsonHeaders(input.botTenantAccessToken),
    body: JSON.stringify({
      start_index: input.startIndex,
      end_index: input.endIndex,
    }),
  });

  const payload = (await response.json()) as FeishuApiPayload;
  ensureSuccess('batch delete block children', response, payload);
}

export async function clearDocxRootChildren(input: ClearDocxRootChildrenInput): Promise<void> {
  for (;;) {
    const rootBlock = await findRootBlock(input);
    const childCount = rootBlock.children.length;
    if (childCount === 0) {
      return;
    }

    await batchDeleteDocxBlockChildren({
      documentId: input.documentId,
      blockId: input.documentId,
      startIndex: 0,
      endIndex: Math.min(childCount, 500),
      botTenantAccessToken: input.botTenantAccessToken,
    });
  }
}

async function findRootBlock(input: ClearDocxRootChildrenInput): Promise<FeishuBlockSummary> {
  let pageToken: string | undefined;

  do {
    const page = await listDocxBlocks({
      documentId: input.documentId,
      botTenantAccessToken: input.botTenantAccessToken,
      ...(pageToken ? { pageToken } : {}),
    });
    const rootBlock = page.items.find((block) => block.blockId === input.documentId);
    if (rootBlock) {
      return rootBlock;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  throw new Error(`Root block not found for document ${input.documentId}`);
}

export async function createDocxDescendantBlocks(
  input: CreateDocxDescendantBlocksInput,
): Promise<FeishuBlockIdRelation[]> {
  const url = `${OPEN_API_BASE}/docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks/${encodeURIComponent(input.blockId)}/descendant`;
  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders(input.botTenantAccessToken),
    body: JSON.stringify({
      children_id: input.request.childrenId,
      descendants: input.request.descendants,
    }),
  });

  const payload = (await response.json()) as FeishuApiPayload<{
    block_id_relations?: Array<{ temporary_block_id?: string; block_id?: string }>;
  }>;
  ensureSuccess('create descendant blocks', response, payload);

  const relations = payload.data?.block_id_relations ?? [];
  return relations.map((relation) => ({
    temporaryBlockId: String(relation.temporary_block_id),
    blockId: String(relation.block_id),
  }));
}

export async function patchDocxBlock(input: PatchDocxBlockInput): Promise<void> {
  const url = `${OPEN_API_BASE}/docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks/${encodeURIComponent(input.blockId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: jsonHeaders(input.botTenantAccessToken),
    body: JSON.stringify(input.body),
  });

  const payload = (await response.json()) as FeishuApiPayload;
  ensureSuccess('patch block', response, payload);
}

export async function transferDocumentOwner(input: TransferDocumentOwnerInput): Promise<void> {
  const url = new URL(
    `${OPEN_API_BASE}/drive/v1/permissions/${encodeURIComponent(input.documentId)}/members/transfer_owner`,
  );
  url.searchParams.set('type', 'docx');

  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders(input.botTenantAccessToken),
    body: JSON.stringify({
      member_type: 'openid',
      member_id: input.ownerOpenId,
    }),
  });

  const payload = (await response.json()) as FeishuApiPayload;
  ensureSuccess('transfer document owner', response, payload);
}
