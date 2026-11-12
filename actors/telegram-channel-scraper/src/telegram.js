/**
 * Network access to Telegram's public channel preview (https://t.me/s/<channel>).
 * No login, no API keys: this is the same page a browser shows to anyone.
 */
import { parseAboutPage, parseChannelPage } from './parser.js';
import { sleep } from './utils.js';

const BASE_URL = 'https://t.me';
const USER_AGENT = 'Mozilla/5.0 (compatible; TelegramChannelScraper/1.0; +https://apify.com)';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 60_000;

export class ChannelUnavailableError extends Error {
    constructor(channel) {
        super(`Channel "${channel}" has no public preview. It does not exist, is private, is a group or a bot, or its preview is restricted.`);
        this.name = 'ChannelUnavailableError';
        this.channel = channel;
    }
}

/**
 * Spaces requests out so that all channels together never exceed `requestsPerSecond`.
 */
export class RateLimiter {
    /** @param {number} requestsPerSecond */
    constructor(requestsPerSecond) {
        this.intervalMs = 1000 / requestsPerSecond;
        this.nextSlot = 0;
    }

    async wait() {
        const now = Date.now();
        const slot = Math.max(now, this.nextSlot);
        this.nextSlot = slot + this.intervalMs;
        if (slot > now) await sleep(slot - now);
    }
}

/**
 * GET with retries on network errors, 429 and 5xx. Redirects are not followed:
 * for this site a redirect means "there is no public preview here".
 *
 * @param {string} url
 * @param {{ rateLimiter?: RateLimiter, fetchImpl?: typeof fetch, retryBaseDelayMs?: number,
 *           log?: { debug: Function, warning: Function } }} [options]
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function fetchPage(url, { rateLimiter, fetchImpl = fetch, log, retryBaseDelayMs = 1000 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await rateLimiter?.wait();
        let retryAfterMs = null;
        try {
            const response = await fetchImpl(url, {
                redirect: 'manual',
                headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (response.status === 429 || response.status >= 500) {
                const header = Number(response.headers.get('retry-after'));
                if (Number.isFinite(header) && header > 0) retryAfterMs = header * 1000;
                await response.body?.cancel().catch(() => {});
                throw new Error(`HTTP ${response.status}`);
            }
            return { status: response.status, body: response.status === 200 ? await response.text() : '' };
        } catch (error) {
            lastError = error;
            if (attempt === MAX_ATTEMPTS) break;
            const backoff = Math.min(MAX_RETRY_DELAY_MS, retryAfterMs ?? retryBaseDelayMs * 2 ** (attempt - 1));
            const delay = backoff + Math.random() * retryBaseDelayMs * 0.5;
            log?.debug(`Request failed (${error.message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(delay)} ms`, { url });
            await sleep(delay);
        }
    }
    throw new Error(`Request to ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`, { cause: lastError });
}

/**
 * Builds the preview URL for a channel page.
 *
 * @param {string} channel
 * @param {{ before?: number | null }} [params]
 */
export function buildChannelUrl(channel, { before = null } = {}) {
    const url = new URL(`/s/${channel}`, BASE_URL);
    if (before != null) url.searchParams.set('before', String(before));
    return url.toString();
}

/**
 * Walks a channel from the newest post to the oldest, one preview page (up to 20 posts) at a time.
 * Posts inside each yielded page are ordered newest first. The consumer stops the walk by breaking out of the loop.
 *
 * @param {object} options
 * @param {string} options.channel
 * @param {number | null} [options.startBefore]      resume cursor: only posts with a lower ID are returned
 * @param {boolean} [options.includeMarkdown]
 * @param {boolean} [options.includeHtml]
 * @param {RateLimiter} [options.rateLimiter]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retryBaseDelayMs]
 * @param {{ debug: Function, warning: Function }} [options.log]
 * @returns {AsyncGenerator<{ channel: NonNullable<ReturnType<typeof parseChannelPage>['channel']>, posts: any[], hasMore: boolean }>}
 */
export async function* walkChannel({ channel, startBefore = null, includeMarkdown, includeHtml, rateLimiter, fetchImpl, retryBaseDelayMs, log }) {
    let before = startBefore;
    for (;;) {
        const url = buildChannelUrl(channel, { before });
        const { status, body } = await fetchPage(url, { rateLimiter, fetchImpl, retryBaseDelayMs, log });
        if (status >= 300 && status < 400) throw new ChannelUnavailableError(channel);
        if (status === 404) throw new ChannelUnavailableError(channel);
        if (status !== 200) throw new Error(`Unexpected HTTP ${status} for ${url}`);

        const page = parseChannelPage(body, { baseUrl: url, includeMarkdown, includeHtml });
        if (!page.isChannelPreview || !page.channel) throw new ChannelUnavailableError(channel);

        const posts = page.posts
            .filter((post) => before == null || post.id < before)
            .sort((a, b) => b.id - a.id);

        // The cursor must move strictly towards older posts, otherwise we would loop forever.
        const next = page.olderCursor;
        const hasMore = next != null && (before == null || next < before);

        yield { channel: page.channel, posts, hasMore };
        if (!hasMore) return;
        before = next;
    }
}

/**
 * Exact subscriber count and description from https://t.me/<channel>.
 * Best effort: returns null when the page cannot be fetched.
 *
 * @param {string} channel
 * @param {{ rateLimiter?: RateLimiter, fetchImpl?: typeof fetch, retryBaseDelayMs?: number,
 *           log?: { debug: Function, warning: Function } }} [options]
 */
export async function fetchChannelAbout(channel, options = {}) {
    try {
        const { status, body } = await fetchPage(`${BASE_URL}/${channel}`, options);
        if (status !== 200) return null;
        return parseAboutPage(body);
    } catch (error) {
        options.log?.debug(`Could not load details of "${channel}": ${error.message}`);
        return null;
    }
}
