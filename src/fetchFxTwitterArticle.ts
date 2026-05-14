import type { FxArticle, FxTwitterApiResponse } from './types.js';

const FX_TWITTER_API_BASE_URL = 'https://api.fxtwitter.com';

export function parseXArticleUrl(articleUrl: string): { author: string; statusId: string } {
  let url: URL;

  try {
    url = new URL(articleUrl);
  } catch {
    throw new Error(`Invalid article URL: ${articleUrl}`);
  }

  if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname)) {
    throw new Error(`Unsupported article host: ${url.hostname}`);
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 3 || segments[1] !== 'status') {
    throw new Error(`Unsupported x.com article path: ${url.pathname}`);
  }

  const [author, , statusId] = segments;
  if (!author || !statusId) {
    throw new Error(`Could not parse x.com article URL: ${articleUrl}`);
  }

  return { author, statusId };
}

export async function fetchFxTwitterArticle(articleUrl: string): Promise<FxArticle & { sourceTweetUrl: string; authorName: string; authorHandle: string }> {
  const { author, statusId } = parseXArticleUrl(articleUrl);
  const response = await fetch(`${FX_TWITTER_API_BASE_URL}/${author}/status/${statusId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch article data from fxtwitter: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as FxTwitterApiResponse;
  const tweet = payload.tweet;

  if (!tweet?.article) {
    throw new Error('fxtwitter response does not contain tweet.article');
  }

  return {
    ...tweet.article,
    sourceTweetUrl: tweet.url,
    authorName: tweet.author.name,
    authorHandle: tweet.author.screen_name,
  };
}
