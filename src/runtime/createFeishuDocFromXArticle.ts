import {
  clearDocxRootChildren,
  createDocxDescendantBlocks,
  createDocxDocument,
  patchDocxBlock,
  resolveDocxDocumentFromUrl,
  transferDocumentOwner,
} from '../feishuDocsHttp.js';
import { uploadFileToDocument, uploadImageToDocument } from '../feishuBotHttp.js';
import { fetchFxTwitterArticle } from '../fetchFxTwitterArticle.js';
import { normalizeArticle } from '../mapping/normalizeArticle.js';
import { renderDocumentPlan } from '../mapping/renderDocumentPlan.js';
import { renderFeishuBlocks } from '../mapping/renderFeishuBlocks.js';
import type { CreateFeishuDocFromXArticleInput, CreateFeishuDocFromXArticleResult } from '../types.js';

export async function createFeishuDocFromXArticle(
  input: CreateFeishuDocFromXArticleInput,
): Promise<CreateFeishuDocFromXArticleResult> {
  const article = await fetchFxTwitterArticle(input.articleUrl);
  const normalizedArticle = normalizeArticle(article);
  const plan = renderDocumentPlan(normalizedArticle);
  const rendered = renderFeishuBlocks(plan);

  const reusing = Boolean(input.existingDocumentUrl);
  const target = reusing
    ? resolveDocxDocumentFromUrl(input.existingDocumentUrl as string)
    : await createDocxDocument({
        title: plan.title,
        botTenantAccessToken: input.botTenantAccessToken,
      });
  const { documentId, docUrl } = target;

  if (reusing) {
    await clearDocxRootChildren({
      documentId,
      botTenantAccessToken: input.botTenantAccessToken,
    });
  }

  const relations = await createDocxDescendantBlocks({
    documentId,
    blockId: documentId,
    request: rendered,
    botTenantAccessToken: input.botTenantAccessToken,
  });

  const relationMap = new Map(relations.map((relation) => [relation.temporaryBlockId, relation.blockId]));

  for (const image of rendered.nativeImages) {
    const blockId = relationMap.get(image.temporaryBlockId);
    if (!blockId) {
      throw new Error(`Missing resolved block id for image placeholder ${image.temporaryBlockId}`);
    }

    const response = await fetch(image.imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${image.imageUrl}`);
    }

    const fileBytes = new Uint8Array(await response.arrayBuffer());
    const uploaded = await uploadImageToDocument({
      documentId,
      blockId,
      fileName: image.fileName,
      fileBytes,
      botTenantAccessToken: input.botTenantAccessToken,
    });

    await patchDocxBlock({
      documentId,
      blockId,
      body: { replace_image: { token: uploaded.fileToken } },
      botTenantAccessToken: input.botTenantAccessToken,
    });
  }

  for (const video of rendered.nativeFiles) {
    const fileBlockId = relationMap.get(video.fileTemporaryBlockId);
    const viewBlockId = relationMap.get(video.viewTemporaryBlockId);
    if (!fileBlockId || !viewBlockId) {
      throw new Error(`Missing resolved video block ids for ${video.fileTemporaryBlockId}`);
    }

    const response = await fetch(video.fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${video.fileUrl}`);
    }

    const fileBytes = new Uint8Array(await response.arrayBuffer());
    const uploaded = await uploadFileToDocument({
      documentId,
      blockId: fileBlockId,
      fileName: video.fileName,
      fileBytes,
      botTenantAccessToken: input.botTenantAccessToken,
    });

    await patchDocxBlock({
      documentId,
      blockId: fileBlockId,
      body: { replace_file: { token: uploaded.fileToken } },
      botTenantAccessToken: input.botTenantAccessToken,
    });
  }

  if (!reusing) {
    await transferDocumentOwner({
      documentId,
      ownerOpenId: input.ownerOpenId,
      botTenantAccessToken: input.botTenantAccessToken,
    });
  }

  return { docUrl };
}
