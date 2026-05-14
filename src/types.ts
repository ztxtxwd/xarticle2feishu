export type FxTwitterApiResponse = {
  code: number;
  message: string;
  tweet?: FxTweet;
};

export type FxTweet = {
  url: string;
  id: string;
  author: {
    name: string;
    screen_name: string;
    url: string;
  };
  article?: FxArticle;
};

export type FxArticle = {
  id: string;
  title: string;
  preview_text?: string;
  created_at: string;
  modified_at: string;
  cover_media?: FxCoverMedia;
  content: FxContent;
  media_entities?: FxMediaEntity[];
};

export type FxCoverMedia = {
  media_id: string;
  media_key: string;
  media_info?: FxImageMediaInfo;
};

export type FxContent = {
  blocks: FxBlock[];
  entityMap: FxEntityMapEntry[];
};

export type FxBlock = {
  key: string;
  text: string;
  type: string;
  data: Record<string, unknown>;
  entityRanges: FxEntityRange[];
  inlineStyleRanges: FxInlineStyleRange[];
};

export type FxEntityRange = {
  key: number;
  offset: number;
  length: number;
};

export type FxInlineStyleRange = {
  offset: number;
  length: number;
  style: string;
};

export type FxEntityMapEntry = {
  key: string;
  value: FxEntityValue;
};

export type FxEntityValue = {
  type: string;
  mutability: string;
  data: Record<string, unknown>;
};

export type FxMediaEntity = {
  media_id: string;
  media_key: string;
  media_info: FxImageMediaInfo | FxVideoMediaInfo;
};

export type FxImageMediaInfo = {
  __typename: 'ApiImage';
  original_img_url: string;
  original_img_width?: number;
  original_img_height?: number;
};

export type FxVideoMediaInfo = {
  __typename: 'ApiVideo';
  duration_millis?: number;
  preview_image?: FxImageMediaInfo;
  variants?: FxVideoVariant[];
};

export type FxVideoVariant = {
  url: string;
  content_type: string;
  bit_rate?: number;
};

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; url: string };

export type RichTextSpan = {
  text: string;
  marks: RichTextMark[];
};

export type NormalizedBlock =
  | { type: 'paragraph'; spans: RichTextSpan[] }
  | { type: 'heading1'; spans: RichTextSpan[] }
  | { type: 'heading2'; spans: RichTextSpan[] }
  | { type: 'bullet'; spans: RichTextSpan[] }
  | { type: 'ordered'; spans: RichTextSpan[] }
  | { type: 'quote'; spans: RichTextSpan[] }
  | { type: 'code'; language: 'Markdown' | 'PlainText'; content: string }
  | { type: 'divider' }
  | { type: 'image'; url: string; width?: number; height?: number }
  | { type: 'video'; posterUrl?: string; videoUrl: string; durationMs?: number }
  | { type: 'unsupported'; originalType: string; text: string };

export type NormalizedArticle = {
  title: string;
  authorName: string;
  authorHandle: string;
  articleUrl: string;
  sourceTweetUrl: string;
  previewText?: string;
  coverImage?: {
    url: string;
    width?: number;
    height?: number;
  };
  blocks: NormalizedBlock[];
};

export type DocumentPlanOperation =
  | { type: 'createDocument'; title: string }
  | { type: 'appendHeading'; level: 1 | 2; spans: RichTextSpan[] }
  | { type: 'appendParagraph'; spans: RichTextSpan[] }
  | { type: 'appendListItem'; kind: 'bullet' | 'ordered'; spans: RichTextSpan[] }
  | { type: 'appendQuote'; spans: RichTextSpan[] }
  | { type: 'appendCode'; language: 'Markdown' | 'PlainText'; content: string }
  | { type: 'appendDivider' }
  | { type: 'appendImage'; url: string; width?: number; height?: number }
  | { type: 'appendVideoFallback'; posterUrl?: string; videoUrl: string; durationMs?: number };

export type DocumentPlan = {
  title: string;
  operations: DocumentPlanOperation[];
};

export type FeishuTextElementStyle = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  inline_code?: boolean;
  link?: {
    url: string;
  };
};

export type FeishuTextElement = {
  text_run: {
    content: string;
    text_element_style?: FeishuTextElementStyle;
  };
};

export type FeishuTextBlockData = {
  style?: {
    folded?: boolean;
    language?: number;
    wrap?: boolean;
    sequence?: string;
  };
  elements: FeishuTextElement[];
};

export type FeishuCodeBlockData = {
  style?: {
    language?: number;
    wrap?: boolean;
  };
  elements: FeishuTextElement[];
};

export type FeishuImageBlockData = {
  width?: number;
  height?: number;
  caption?: {
    content: string;
  };
  token?: string;
};

export type FeishuFileBlockData = {
  token?: string;
  name?: string;
  view_type?: 1 | 2;
};

export type FeishuViewBlockData = {
  view_type: 1 | 2;
};

export type FeishuBlockInput = {
  block_id: string;
  children?: string[];
  block_type: number;
  text?: FeishuTextBlockData;
  heading1?: FeishuTextBlockData;
  heading2?: FeishuTextBlockData;
  bullet?: FeishuTextBlockData;
  ordered?: FeishuTextBlockData;
  quote?: FeishuTextBlockData;
  code?: FeishuCodeBlockData;
  image?: FeishuImageBlockData;
  file?: FeishuFileBlockData;
  view?: FeishuViewBlockData;
  divider?: Record<string, never>;
};

export type FeishuDescendantRequest = {
  childrenId: string[];
  descendants: FeishuBlockInput[];
};

export type FeishuBlockIdRelation = {
  temporaryBlockId: string;
  blockId: string;
};

export type NativeImageUploadTarget = {
  temporaryBlockId: string;
  imageUrl: string;
  fileName: string;
  width?: number;
  height?: number;
};

export type NativeFileUploadTarget = {
  viewTemporaryBlockId: string;
  fileTemporaryBlockId: string;
  fileUrl: string;
  fileName: string;
};

export type FeishuRenderedBlocks = FeishuDescendantRequest & {
  nativeImages: NativeImageUploadTarget[];
  nativeFiles: NativeFileUploadTarget[];
};

export type CreateFeishuDocFromXArticleInput = {
  articleUrl: string;
  feishuMcpServerUrl: string;
  botTenantAccessToken: string;
};

export type CreateFeishuDocFromXArticleResult = {
  docUrl: string;
};

export type FeishuBotInfo = {
  openId: string;
};

export type FeishuDocumentPermissionInput = {
  documentId: string;
  openId: string;
  documentType: 'docx';
};

export type FeishuMediaUploadInput = {
  documentId: string;
  blockId: string;
  fileName: string;
  fileBytes: Uint8Array;
  botTenantAccessToken: string;
};

export type FeishuMediaUploadResult = {
  fileToken: string;
};

export type FeishuMultipartUploadPrepareResult = {
  uploadId: string;
  blockSize: number;
  blockNum: number;
};

export type FeishuReplaceImageInput = {
  documentId: string;
  blockId: string;
  fileToken: string;
};

export type FeishuReplaceFileInput = {
  documentId: string;
  blockId: string;
  fileToken: string;
};
