/**
 * Validation of the Actor input. Kept free of Apify imports so it can be unit tested.
 */
import { InputError, normalizeChannel, parseDateBound } from './utils.js';

const MAX_POSTS_HARD_LIMIT = 1_000_000;

/** Accepts an array or a single string with usernames separated by commas, spaces or new lines. */
function toList(value) {
    const items = Array.isArray(value) ? value : [value];
    return items
        .flatMap((item) => (typeof item === 'string' ? item.split(/[\s,;]+/) : []))
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * Validates the raw input and converts it to the settings used by the run.
 *
 * @param {Record<string, any>} raw
 * @param {Date} [now]
 */
export function readInput(raw, now = new Date()) {
    const channels = [];
    const rejected = [];
    const seen = new Set();
    for (const value of toList(raw.channels)) {
        try {
            const username = normalizeChannel(value);
            if (seen.has(username.toLowerCase())) continue;
            seen.add(username.toLowerCase());
            channels.push({ input: value, username });
        } catch (error) {
            if (!(error instanceof InputError)) throw error;
            rejected.push({ input: value, reason: error.message });
        }
    }
    if (channels.length === 0) {
        const details = rejected.length ? ` Rejected: ${rejected.map((item) => item.reason).join(' ')}` : '';
        throw new InputError(`Add at least one public channel to "channels", for example "telegram" or "https://t.me/telegram".${details}`);
    }

    const maxPosts = Number(raw.maxPostsPerChannel ?? 100);
    if (!Number.isInteger(maxPosts) || maxPosts < 1) {
        throw new InputError('"maxPostsPerChannel" must be a whole number of 1 or more.');
    }

    const fromDate = parseDateBound(raw.postsFrom, { now, field: 'postsFrom' });
    const toDate = parseDateBound(raw.postsTo, { now, endOfDay: true, field: 'postsTo' });
    if (fromDate && toDate && fromDate > toDate) {
        throw new InputError('"postsFrom" is later than "postsTo", so no post can match.');
    }

    const monitorId = String(raw.monitorId ?? '').trim() || 'default';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(monitorId)) {
        throw new InputError('"monitorId" may contain only letters, digits, "-" and "_" (up to 64 characters).');
    }

    return {
        channels,
        rejected,
        maxPosts: Math.min(maxPosts, MAX_POSTS_HARD_LIMIT),
        fromDate,
        toDate,
        keywords: readKeywords(raw.keywords),
        onlyNewPosts: raw.onlyNewPosts === true,
        monitorId,
        includeMarkdown: raw.includeMarkdown === true,
        includeHtml: raw.includeHtml === true,
        includeChannelDetails: raw.includeChannelDetails !== false,
    };
}

/**
 * Keywords and phrases, lower-cased and without duplicates. Phrases may contain spaces,
 * so a single string is split only at commas and line breaks.
 */
function readKeywords(value) {
    const items = Array.isArray(value) ? value : [value];
    const keywords = items
        .flatMap((item) => (typeof item === 'string' ? item.split(/[,\n]+/) : []))
        .map((item) => item.trim().toLocaleLowerCase())
        .filter(Boolean);
    return [...new Set(keywords)];
}

/** Key under which a channel is remembered between monitoring runs. */
export const stateKey = (username) => username.toLowerCase();
