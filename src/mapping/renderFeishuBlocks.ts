import type {
  DocumentPlan,
  DocumentPlanOperation,
  FeishuBlockInput,
  FeishuRenderedBlocks,
  FeishuTextElement,
  FeishuTextElementStyle,
  NativeFileUploadTarget,
  NativeImageUploadTarget,
  RichTextSpan,
} from '../types.js';

const CODE_LANGUAGE_MAP: Record<'Markdown' | 'PlainText', number> = {
  PlainText: 1,
  Markdown: 39,
};

type OperationRenderResult = {
  blocks: FeishuBlockInput[];
  rootIds: string[];
};

function codeElements(content: string): FeishuTextElement[] {
  return [{ text_run: { content } }];
}

function makeCodeBlock(blockId: string, language: 'Markdown' | 'PlainText', content: string): FeishuBlockInput {
  return {
    block_id: blockId,
    block_type: 14,
    code: {
      style: {
        language: CODE_LANGUAGE_MAP[language],
        wrap: false,
      },
      elements: codeElements(content),
    },
  };
}

function encodeLinkUrl(url: string): string {
  return encodeURIComponent(url);
}

function spanStyle(span: RichTextSpan): FeishuTextElementStyle | undefined {
  const style: FeishuTextElementStyle = {};

  for (const mark of span.marks) {
    if (mark.type === 'bold') {
      style.bold = true;
    } else if (mark.type === 'italic') {
      style.italic = true;
    } else if (mark.type === 'link') {
      style.link = { url: encodeLinkUrl(mark.url) };
    }
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function textElements(spans: RichTextSpan[]): FeishuTextElement[] {
  return spans
    .filter((span) => span.text.length > 0)
    .map((span) => ({
      text_run: {
        content: span.text,
        text_element_style: spanStyle(span),
      },
    }));
}

function plainSpans(text: string): RichTextSpan[] {
  return [{ text, marks: [] }];
}

function blockData(spans: RichTextSpan[]) {
  return {
    elements: textElements(spans),
  };
}

function makeBlock(blockId: string, blockType: number, field: keyof FeishuBlockInput, spans?: RichTextSpan[]): FeishuBlockInput {
  if (field === 'divider') {
    return {
      block_id: blockId,
      block_type: blockType,
      divider: {},
    };
  }

  return {
    block_id: blockId,
    block_type: blockType,
    [field]: blockData(spans ?? []),
  };
}

function hasTextElements(block: FeishuBlockInput, field: 'text' | 'heading1' | 'heading2' | 'bullet' | 'ordered' | 'quote'): boolean {
  const data = block[field];
  return Boolean(data && data.elements.length > 0);
}

function makeImagePlaceholder(blockId: string, operation: Extract<DocumentPlanOperation, { type: 'appendImage' }>): FeishuBlockInput {
  return {
    block_id: blockId,
    block_type: 27,
    image: {
      width: operation.width,
      height: operation.height,
      caption: {
        content: 'image',
      },
    },
  };
}

function makeVideoPlaceholder(fileBlockId: string, viewBlockId: string): FeishuBlockInput[] {
  return [
    {
      block_id: viewBlockId,
      block_type: 33,
      children: [fileBlockId],
      view: {
        view_type: 2,
      },
    },
    {
      block_id: fileBlockId,
      block_type: 23,
      file: {
        view_type: 2,
      },
    },
  ];
}

function operationToBlocks(
  operation: Exclude<DocumentPlanOperation, { type: 'createDocument' }>,
  nextId: () => string,
  nativeImages: NativeImageUploadTarget[],
  nativeFiles: NativeFileUploadTarget[],
): OperationRenderResult {
  switch (operation.type) {
    case 'appendHeading': {
      const block = makeBlock(nextId(), operation.level === 1 ? 3 : 4, operation.level === 1 ? 'heading1' : 'heading2', operation.spans);
      if (!hasTextElements(block, operation.level === 1 ? 'heading1' : 'heading2')) {
        return { blocks: [], rootIds: [] };
      }
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendParagraph': {
      const block = makeBlock(nextId(), 2, 'text', operation.spans);
      if (block.text && block.text.elements.length === 0) {
        return { blocks: [], rootIds: [] };
      }
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendListItem': {
      const block = makeBlock(nextId(), operation.kind === 'bullet' ? 12 : 13, operation.kind === 'bullet' ? 'bullet' : 'ordered', operation.spans);
      if (!hasTextElements(block, operation.kind === 'bullet' ? 'bullet' : 'ordered')) {
        return { blocks: [], rootIds: [] };
      }
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendQuote': {
      const block = makeBlock(nextId(), 15, 'quote', operation.spans);
      if (!hasTextElements(block, 'quote')) {
        return { blocks: [], rootIds: [] };
      }
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendCode': {
      const block = makeCodeBlock(nextId(), operation.language, operation.content);
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendDivider': {
      const block = makeBlock(nextId(), 22, 'divider');
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendImage': {
      const blockId = nextId();
      const fileExtension = operation.url.split('.').pop()?.split('?')[0] ?? 'png';
      nativeImages.push({
        temporaryBlockId: blockId,
        imageUrl: operation.url,
        fileName: `image.${fileExtension}`,
        width: operation.width,
        height: operation.height,
      });
      const block = makeImagePlaceholder(blockId, operation);
      return { blocks: [block], rootIds: [block.block_id] };
    }
    case 'appendVideoFallback': {
      const fileBlockId = nextId();
      const viewBlockId = nextId();
      nativeFiles.push({
        fileTemporaryBlockId: fileBlockId,
        viewTemporaryBlockId: viewBlockId,
        fileUrl: operation.videoUrl,
        fileName: 'video.mp4',
      });
      const blocks = makeVideoPlaceholder(fileBlockId, viewBlockId);
      return { blocks, rootIds: [viewBlockId] };
    }
  }
}

export function renderFeishuBlocks(plan: DocumentPlan): FeishuRenderedBlocks {
  let sequence = 0;
  const nextId = (): string => `tmp_${sequence += 1}`;

  const descendants: FeishuBlockInput[] = [];
  const childrenId: string[] = [];
  const nativeImages: NativeImageUploadTarget[] = [];
  const nativeFiles: NativeFileUploadTarget[] = [];

  for (const operation of plan.operations) {
    if (operation.type === 'createDocument') {
      continue;
    }

    const rendered = operationToBlocks(operation, nextId, nativeImages, nativeFiles);
    descendants.push(...rendered.blocks);
    childrenId.push(...rendered.rootIds);
  }

  if (descendants.length === 0) {
    const fallback = makeBlock(nextId(), 2, 'text', plainSpans(plan.title));
    childrenId.push(fallback.block_id);
    descendants.push(fallback);
  }

  return {
    childrenId,
    descendants,
    nativeImages,
    nativeFiles,
  };
}
