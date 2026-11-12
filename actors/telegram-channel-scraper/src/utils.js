/**
 * Small pure helpers shared by the parser and the scraper.
 */

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,31}$/;
const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog', 'www.t.me']);

/** Path segments on t.me that are never a channel username. */
const RESERVED_SEGMENTS = new Set([
    'joinchat', 'addstickers', 'addemoji', 'addlist', 'addtheme', 'proxy', 'socks',
    'share', 'login', 'iv', 'setlanguage', 'bg', 'invoice', 'boost', 'giftcode', 'm', 'c',
]);

export class InputError extends Error {}

/**
 * Turns anything a user may paste (username, @username, t.me link, link to a single post)
 * into a bare channel username.
 *
 * @param {string} raw
 * @returns {string} username without "@"
 * @throws {InputError} when the value cannot refer to a public channel
 */
export function normalizeChannel(raw) {
    const value = String(raw ?? '').trim();
    if (!value) throw new InputError('Empty channel value.');

    let candidate = value;

    const tgLink = value.match(/^tg:\/\/resolve\?(?:.*&)?domain=([^&\s]+)/i);
    if (tgLink) {
        candidate = tgLink[1];
    } else if (/^(https?:)?\/\//i.test(value) || /^[\w.-]+\.[a-z]{2,}\//i.test(value)) {
        let url;
        try {
            url = new URL(/^(https?:)?\/\//i.test(value) ? value.replace(/^\/\//, 'https://') : `https://${value}`);
        } catch {
            throw new InputError(`"${value}" is not a valid link.`);
        }
        if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) {
            throw new InputError(`"${value}" is not a Telegram link (expected t.me/...).`);
        }
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 's') segments.shift();
        const first = segments[0] ?? '';
        if (first.startsWith('+') || RESERVED_SEGMENTS.has(first.toLowerCase())) {
            throw new InputError(`"${value}" is an invite or service link. Only public channels with a username are supported.`);
        }
        candidate = first;
    }

    candidate = candidate.replace(/^@/, '');
    if (!USERNAME_RE.test(candidate)) {
        throw new InputError(`"${value}" is not a valid public channel username.`);
    }
    return candidate;
}

/**
 * Parses Telegram's abbreviated counters: "635K" -> 635000, "6.83M" -> 6830000, "10 043 167" -> 10043167.
 * Returns null when there is no number.
 *
 * @param {string | undefined | null} text
 * @returns {number | null}
 */
export function parseCount(text) {
    if (text == null) return null;
    const cleaned = String(text).replace(/[\s  ,]/g, '').trim();
    const match = cleaned.match(/^(\d+(?:\.\d+)?)([KMB])?/i);
    if (!match) return null;
    const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? '').toUpperCase()] ?? 1;
    return Math.round(Number(match[1]) * multiplier);
}

/**
 * "0:20" -> 20, "1:02:03" -> 3723. Returns null for anything else.
 *
 * @param {string | undefined | null} text
 * @returns {number | null}
 */
export function parseDuration(text) {
    const value = String(text ?? '').trim();
    if (!/^\d+(:\d{1,2}){1,2}$/.test(value)) return null;
    return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * Extracts the URL from a CSS `background-image:url('...')` declaration.
 *
 * @param {string | undefined | null} style
 * @returns {string | null}
 */
export function urlFromStyle(style) {
    const match = String(style ?? '').match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
    if (!match) return null;
    const url = match[2].trim();
    if (!url || url.startsWith('data:')) return null;
    return url.startsWith('//') ? `https:${url}` : url;
}

const RELATIVE_UNITS_MS = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
};

/**
 * Parses a date bound given either as an absolute date ("2026-11-01", ISO date-time)
 * or as a relative period ("7 days", "2 weeks", "1 month").
 *
 * @param {string | undefined | null} value
 * @param {{ now?: Date, endOfDay?: boolean, field?: string }} [options]
 * @returns {Date | null}
 */
export function parseDateBound(value, { now = new Date(), endOfDay = false, field = 'date' } = {}) {
    const text = String(value ?? '').trim();
    if (!text) return null;

    const relative = text.match(/^(\d+)\s*(minute|hour|day|week|month|year)s?$/i);
    if (relative) {
        return new Date(now.getTime() - Number(relative[1]) * RELATIVE_UNITS_MS[relative[2].toLowerCase()]);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
        if (!Number.isNaN(date.getTime())) return date;
    } else {
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) return date;
    }
    throw new InputError(`"${text}" in "${field}" is not a date. Use YYYY-MM-DD or a period such as "7 days".`);
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Runs `worker` over `items` with at most `limit` running at once.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<void>} worker
 */
export async function runWithConcurrency(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const index = next++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}
