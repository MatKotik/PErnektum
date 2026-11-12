/**
 * Scrapes one channel: walks its preview pages, applies limits and filters,
 * and hands finished posts to the caller. Knows nothing about Apify.
 */
import { fetchChannelAbout, walkChannel } from './telegram.js';

/**
 * @typedef {object} ChannelResult
 * @property {string} channel            canonical username
 * @property {string | null} title
 * @property {number | null} subscribers
 * @property {number} pushed             posts delivered in total (including a resumed part)
 * @property {number | null} newestSeenId
 * @property {'end' | 'limit' | 'date' | 'seen' | 'budget'} stopReason
 */

/**
 * @param {object} options
 * @param {string} options.channel
 * @param {string[]} [options.keywords]           keep only posts that contain at least one of these (lower case)
 * @param {number} options.maxPosts
 * @param {Date | null} [options.fromDate]        skip posts older than this
 * @param {Date | null} [options.toDate]          skip posts newer than this
 * @param {number | null} [options.lastSeenId]    monitoring: stop at posts already delivered by an earlier run
 * @param {{ cursor: number | null, pushed: number, newestSeenId: number | null } | null} [options.resume]
 * @param {boolean} [options.includeMarkdown]
 * @param {boolean} [options.includeHtml]
 * @param {boolean} [options.includeChannelDetails]
 * @param {(posts: object[]) => Promise<number>} options.pushPosts   returns how many posts were accepted
 * @param {(progress: { cursor: number | null, pushed: number, newestSeenId: number | null }) => void} [options.onProgress]
 * @param {import('./telegram.js').RateLimiter} [options.rateLimiter]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retryBaseDelayMs]
 * @param {{ debug: Function, warning: Function }} [options.log]
 * @param {() => Date} [options.now]
 * @returns {Promise<ChannelResult>}
 */
export async function scrapeChannel({
    channel,
    keywords = [],
    maxPosts,
    fromDate = null,
    toDate = null,
    lastSeenId = null,
    resume = null,
    includeMarkdown = false,
    includeHtml = false,
    includeChannelDetails = true,
    pushPosts,
    onProgress = () => {},
    rateLimiter,
    fetchImpl,
    retryBaseDelayMs,
    log,
    now = () => new Date(),
}) {
    let pushed = resume?.pushed ?? 0;
    let newestSeenId = resume?.newestSeenId ?? null;
    let cursor = resume?.cursor ?? null;
    let info = null;

    const result = (stopReason) => ({
        channel: info?.username ?? channel,
        title: info?.title ?? null,
        subscribers: info?.subscribers ?? null,
        pushed,
        newestSeenId,
        stopReason,
    });

    if (pushed >= maxPosts) return result('limit');

    const http = { rateLimiter, fetchImpl, retryBaseDelayMs, log };
    const pages = walkChannel({ channel, startBefore: cursor, includeMarkdown, includeHtml, ...http });
    for await (const page of pages) {
        if (!info) {
            info = { ...page.channel, username: page.channel.username ?? channel };
            if (includeChannelDetails) {
                const about = await fetchChannelAbout(info.username, http);
                if (about?.subscribers != null) info.subscribers = about.subscribers;
            }
        }

        const batch = [];
        let stopReason = null;
        for (const post of page.posts) {
            if (newestSeenId == null || post.id > newestSeenId) newestSeenId = post.id;
            if (lastSeenId != null && post.id <= lastSeenId) {
                stopReason = 'seen';
                break;
            }
            const date = post.date ? new Date(post.date) : null;
            if (toDate && date && date > toDate) continue;
            if (fromDate && date && date < fromDate) {
                stopReason = 'date';
                break;
            }
            const matchedKeywords = keywords.length > 0 ? matchKeywords(post, keywords) : null;
            if (matchedKeywords && matchedKeywords.length === 0) continue;
            batch.push(decorate(post, info, { matchedKeywords, scrapedAt: now() }));
            if (pushed + batch.length >= maxPosts) {
                stopReason = 'limit';
                break;
            }
        }

        if (batch.length > 0) {
            const accepted = await pushPosts(batch);
            pushed += accepted;
            if (accepted < batch.length) stopReason = 'budget';
        }

        if (page.posts.length > 0) cursor = page.posts[page.posts.length - 1].id;
        onProgress({ cursor, pushed, newestSeenId });

        if (stopReason) return result(stopReason);
        if (!page.hasMore) return result('end');
    }
    return result('end');
}

/**
 * Which of the keywords occur in the post. The search covers the text, poll, link preview and file names,
 * ignores letter case and matches parts of words, so "update" also finds "updates".
 *
 * @param {any} post
 * @param {string[]} keywords  lower case
 * @returns {string[]}
 */
export function matchKeywords(post, keywords) {
    const haystack = [
        post.text,
        post.poll?.question,
        ...(post.poll?.options ?? []).map((option) => option.text),
        post.linkPreview?.title,
        post.linkPreview?.description,
        ...(post.documents ?? []).map((document) => document.title),
    ].filter(Boolean).join('\n').toLocaleLowerCase();
    return keywords.filter((keyword) => haystack.includes(keyword));
}

/**
 * Final shape of a dataset item: channel fields first, then the post itself.
 */
function decorate(post, info, { matchedKeywords, scrapedAt }) {
    const { channel: _channel, markdown, html, ...rest } = post;
    const item = {
        channel: info.username,
        channelTitle: info.title,
        channelSubscribers: info.subscribers,
        channelIsVerified: info.isVerified,
        ...rest,
        url: `https://t.me/${info.username}/${post.id}`,
    };
    if (markdown !== undefined) item.markdown = markdown;
    if (html !== undefined) item.html = html;
    if (matchedKeywords) item.matchedKeywords = matchedKeywords;
    item.scrapedAt = scrapedAt.toISOString();
    return item;
}
