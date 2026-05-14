import { fetchFxTwitterArticle } from '../fetchFxTwitterArticle.js';
import { fetchBotInfo, uploadFileToDocument, uploadImageToDocument } from '../feishuBotHttp.js';
import { normalizeArticle } from '../mapping/normalizeArticle.js';
import { renderDocumentPlan } from '../mapping/renderDocumentPlan.js';
import { renderFeishuBlocks } from '../mapping/renderFeishuBlocks.js';
import { connectFeishuMcp } from '../mcp/connectFeishuMcp.js';
import { FeishuTools } from '../mcp/feishuTools.js';
import type { CreateFeishuDocFromXArticleInput, CreateFeishuDocFromXArticleResult } from '../types.js';

export async function createFeishuDocFromXArticle(
  input: CreateFeishuDocFromXArticleInput,
): Promise<CreateFeishuDocFromXArticleResult> {
  const article = await fetchFxTwitterArticle(input.articleUrl);
  const normalizedArticle = normalizeArticle(article);
  const plan = renderDocumentPlan(normalizedArticle);
  const rendered = renderFeishuBlocks(plan);
  const { client, transport } = await connectFeishuMcp(input.feishuMcpServerUrl);

  try {
    const feishuTools = await FeishuTools.create(client);
    const targetDocument = input.existingDocumentUrl
      ? feishuTools.resolveDocumentFromUrl(input.existingDocumentUrl)
      : await feishuTools.createDocument(plan.title);
    const { documentId, docUrl } = targetDocument;
    if (input.existingDocumentUrl) {
      await feishuTools.clearDocumentRootChildren(documentId);
    }
    const relations = await feishuTools.createDescendantBlocks(documentId, rendered);

    const botOpenId = (await fetchBotInfo(input.botTenantAccessToken)).openId;
    await feishuTools.grantDocumentPermission({
      documentId,
      openId: botOpenId,
      documentType: 'docx',
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

      await feishuTools.replaceImage({
        documentId,
        blockId,
        fileToken: uploaded.fileToken,
      });
    }

    for (const video of rendered.nativeFiles) {
      const viewBlockId = relationMap.get(video.viewTemporaryBlockId);
      const fileBlockId = relationMap.get(video.fileTemporaryBlockId);
      if (!viewBlockId || !fileBlockId) {
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

      await feishuTools.replaceFile({
        documentId,
        blockId: fileBlockId,
        fileToken: uploaded.fileToken,
      });
    }

    return { docUrl };
  } finally {
    await transport.close().catch(() => undefined);
  }
}
