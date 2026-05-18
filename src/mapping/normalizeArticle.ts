import type {
  FxArticle,
  FxBlock,
  FxEntityMapEntry,
  FxInlineStyleRange,
  FxMediaEntity,
  FxVideoMediaInfo,
  NormalizedArticle,
  NormalizedBlock,
  RichTextMark,
  RichTextSpan,
} from '../types.js';

function asEntityMap(entityMap: FxEntityMapEntry[]): Map<number, FxEntityMapEntry['value']> {
  return new Map(entityMap.map((entry) => [Number(entry.key), entry.value]));
}

function mediaById(mediaEntities: FxMediaEntity[] | undefined): Map<string, FxMediaEntity> {
  return new Map((mediaEntities ?? []).map((entity) => [entity.media_id, entity]));
}

function appendMarks(target: RichTextMark[], marks: RichTextMark[]): RichTextMark[] {
  const seen = new Set(target.map((mark) => JSON.stringify(mark)));
  for (const mark of marks) {
    const key = JSON.stringify(mark);
    if (!seen.has(key)) {
      seen.add(key);
      target.push(mark);
    }
  }
  return target;
}

function sliceText(text: string, start: number, end: number): string {
  return text.slice(start, end);
}

function buildRichTextSpans(block: FxBlock, entityMap: Map<number, FxEntityMapEntry['value']>): RichTextSpan[] {
  const boundaries = new Set<number>([0, block.text.length]);

  for (const range of block.inlineStyleRanges) {
    boundaries.add(range.offset);
    boundaries.add(range.offset + range.length);
  }

  for (const range of block.entityRanges) {
    boundaries.add(range.offset);
    boundaries.add(range.offset + range.length);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const spans: RichTextSpan[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const text = sliceText(block.text, start, end);

    if (!text) {
      continue;
    }

    const marks: RichTextMark[] = [];

    for (const styleRange of block.inlineStyleRanges) {
      if (styleRange.offset <= start && styleRange.offset + styleRange.length >= end) {
        if (styleRange.style === 'Bold') {
          appendMarks(marks, [{ type: 'bold' }]);
        }
        if (styleRange.style === 'Italic') {
          appendMarks(marks, [{ type: 'italic' }]);
        }
      }
    }

    for (const entityRange of block.entityRanges) {
      if (entityRange.offset <= start && entityRange.offset + entityRange.length >= end) {
        const entity = entityMap.get(entityRange.key);
        if (entity?.type === 'LINK') {
          const url = entity.data.url;
          if (typeof url === 'string') {
            appendMarks(marks, [{ type: 'link', url }]);
          }
        }
      }
    }

    const previous = spans.at(-1);
    if (previous && JSON.stringify(previous.marks) === JSON.stringify(marks)) {
      previous.text += text;
      continue;
    }

    spans.push({ text, marks });
  }

  return spans;
}

function bestVideoVariant(video: FxVideoMediaInfo): string | undefined {
  return video.variants
    ?.filter((variant) => variant.content_type === 'video/mp4')
    .sort((left, right) => (right.bit_rate ?? 0) - (left.bit_rate ?? 0))[0]
    ?.url;
}

function isFencedMarkdown(text: string): boolean {
  return /^```[\s\S]*```$/.test(text.trim());
}

function fencedContent(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '');
}

function normalizeMarkdownEntity(block: FxBlock, entityMap: Map<number, FxEntityMapEntry['value']>): NormalizedBlock | null {
  const entityRange = block.entityRanges[0];
  if (!entityRange) {
    return null;
  }

  const entity = entityMap.get(entityRange.key);
  if (entity?.type !== 'MARKDOWN' || typeof entity.data.markdown !== 'string') {
    return null;
  }

  const raw = entity.data.markdown;
  if (!isFencedMarkdown(raw)) {
    return null;
  }

  const firstLine = raw.trim().split('\n', 1)[0];
  const language = /^```markdown\b/i.test(firstLine) ? 'Markdown' : 'PlainText';

  return {
    type: 'code',
    language,
    content: fencedContent(raw),
  };
}

function normalizeAtomicBlock(
  block: FxBlock,
  entityMap: Map<number, FxEntityMapEntry['value']>,
  mediaIndex: Map<string, FxMediaEntity>,
): NormalizedBlock {
  const entityRange = block.entityRanges[0];
  if (!entityRange) {
    return { type: 'unsupported', originalType: block.type, text: block.text };
  }

  const entity = entityMap.get(entityRange.key);
  if (!entity) {
    return { type: 'unsupported', originalType: block.type, text: block.text };
  }

  if (entity.type === 'DIVIDER') {
    return { type: 'divider' };
  }

  if (entity.type === 'MEDIA') {
    const mediaItems = entity.data.mediaItems;
    const mediaId = Array.isArray(mediaItems) ? mediaItems[0]?.mediaId : undefined;
    if (typeof mediaId !== 'string') {
      return { type: 'unsupported', originalType: block.type, text: block.text };
    }

    const media = mediaIndex.get(mediaId);
    if (!media) {
      return { type: 'unsupported', originalType: block.type, text: block.text };
    }

    if (media.media_info.__typename === 'ApiImage') {
      return {
        type: 'image',
        url: media.media_info.original_img_url,
        width: media.media_info.original_img_width,
        height: media.media_info.original_img_height,
      };
    }

    if (media.media_info.__typename === 'ApiVideo') {
      const videoUrl = bestVideoVariant(media.media_info);
      if (!videoUrl) {
        return { type: 'unsupported', originalType: block.type, text: block.text };
      }

      return {
        type: 'video',
        videoUrl,
        durationMs: media.media_info.duration_millis,
        posterUrl: media.media_info.preview_image?.original_img_url,
      };
    }
  }

  return { type: 'unsupported', originalType: block.type, text: block.text };
}

export function normalizeArticle(input: FxArticle & { sourceTweetUrl: string; authorName: string; authorHandle: string }): NormalizedArticle {
  const entityMap = asEntityMap(input.content.entityMap);
  const mediaIndex = mediaById(input.media_entities);

  const blocks = input.content.blocks.map<NormalizedBlock>((block) => {
    const spans = buildRichTextSpans(block, entityMap);
    const markdownCodeBlock = normalizeMarkdownEntity(block, entityMap);
    if (markdownCodeBlock) {
      return markdownCodeBlock;
    }

    switch (block.type) {
      case 'unstyled':
        return { type: 'paragraph', spans };
      case 'header-one':
        return { type: 'heading1', spans };
      case 'header-two':
        return { type: 'heading2', spans };
      case 'unordered-list-item':
        return { type: 'bullet', spans };
      case 'ordered-list-item':
        return { type: 'ordered', spans };
      case 'blockquote':
        return { type: 'quote', spans };
      case 'atomic':
        return normalizeAtomicBlock(block, entityMap, mediaIndex);
      default:
        return { type: 'unsupported', originalType: block.type, text: block.text };
    }
  });

  return {
    title: input.title,
    authorName: input.authorName,
    authorHandle: input.authorHandle,
    articleUrl: input.sourceTweetUrl,
    sourceTweetUrl: input.sourceTweetUrl,
    previewText: input.preview_text,
    coverImage: input.cover_media?.media_info?.__typename === 'ApiImage'
      ? {
          url: input.cover_media.media_info.original_img_url,
          width: input.cover_media.media_info.original_img_width,
          height: input.cover_media.media_info.original_img_height,
        }
      : undefined,
    blocks,
  };
}
