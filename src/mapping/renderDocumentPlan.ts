import type { DocumentPlan, DocumentPlanOperation, NormalizedArticle, RichTextSpan } from '../types.js';

function textSpans(text: string): RichTextSpan[] {
  return [{ text, marks: [] }];
}

export function renderDocumentPlan(article: NormalizedArticle): DocumentPlan {
  const operations: DocumentPlanOperation[] = [
    { type: 'createDocument', title: article.title },
    { type: 'appendHeading', level: 1, spans: textSpans(article.title) },
    { type: 'appendParagraph', spans: textSpans(`Author: ${article.authorName} (@${article.authorHandle})`) },
    { type: 'appendParagraph', spans: [{ text: 'Original article', marks: [{ type: 'link', url: article.articleUrl }] }] },
  ];

  if (article.coverImage) {
    operations.push({
      type: 'appendImage',
      url: article.coverImage.url,
      width: article.coverImage.width,
      height: article.coverImage.height,
    });
  }

  for (const block of article.blocks) {
    switch (block.type) {
      case 'paragraph':
        operations.push({ type: 'appendParagraph', spans: block.spans });
        break;
      case 'heading1':
        operations.push({ type: 'appendHeading', level: 1, spans: block.spans });
        break;
      case 'heading2':
        operations.push({ type: 'appendHeading', level: 2, spans: block.spans });
        break;
      case 'bullet':
        operations.push({ type: 'appendListItem', kind: 'bullet', spans: block.spans });
        break;
      case 'ordered':
        operations.push({ type: 'appendListItem', kind: 'ordered', spans: block.spans });
        break;
      case 'quote':
        operations.push({ type: 'appendQuote', spans: block.spans });
        break;
      case 'code':
        operations.push({ type: 'appendCode', language: block.language, content: block.content });
        break;
      case 'divider':
        operations.push({ type: 'appendDivider' });
        break;
      case 'image':
        operations.push({
          type: 'appendImage',
          url: block.url,
          width: block.width,
          height: block.height,
        });
        break;
      case 'video':
        operations.push({
          type: 'appendVideoFallback',
          posterUrl: block.posterUrl,
          videoUrl: block.videoUrl,
          durationMs: block.durationMs,
        });
        break;
      case 'unsupported':
        if (block.text.trim()) {
          operations.push({ type: 'appendParagraph', spans: textSpans(block.text) });
        }
        break;
    }
  }

  return {
    title: article.title,
    operations,
  };
}
