import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrapeChannel } from '../src/scraper.js';
import { ChannelUnavailableError, fetchPage } from '../src/telegram.js';
import { createFakeTelegram } from './helpers.js';

const CHANNEL = 'testchannel';

/** Runs scrapeChannel against the fake site and collects what was delivered. */
async function scrape(options = {}, site = {}) {
    const fetchImpl = createFakeTelegram({ channel: CHANNEL, ...site });
    const delivered = [];
    const progress = [];
    const result = await scrapeChannel({
        channel: CHANNEL,
        maxPosts: 100,
        pushPosts: async (posts) => { delivered.push(...posts); return posts.length; },
        onProgress: (state) => progress.push({ ...state }),
        fetchImpl,
        retryBaseDelayMs: 1,
        now: () => new Date('2026-11-12T10:00:00.000Z'),
        ...options,
    });
    return { result, delivered, ids: delivered.map((post) => post.id), calls: fetchImpl.calls, progress };
}

const range = (from, to) => Array.from({ length: from - to + 1 }, (_, index) => from - index);

test('returns the newest posts first and stops at the limit', async () => {
    const { result, ids, calls } = await scrape({ maxPosts: 45 }, { total: 100 });

    assert.deepEqual(ids, range(100, 56));
    assert.deepEqual(result, { channel: CHANNEL, title: 'Test Channel', subscribers: 12_345, pushed: 45, newestSeenId: 100, stopReason: 'limit' });
    assert.deepEqual(calls, [`/s/${CHANNEL}`, `/${CHANNEL}`, `/s/${CHANNEL}?before=81`, `/s/${CHANNEL}?before=61`]);
});

test('reads a channel to its first post when the limit is not reached', async () => {
    const { result, ids } = await scrape({ maxPosts: 1000 }, { total: 30 });

    assert.deepEqual(ids, range(30, 1));
    assert.equal(result.stopReason, 'end');
});

test('adds channel fields to every post', async () => {
    const { delivered } = await scrape({ maxPosts: 1 }, { total: 3 });

    assert.equal(delivered.length, 1);
    const [post] = delivered;
    assert.equal(post.channel, CHANNEL);
    assert.equal(post.channelTitle, 'Test Channel');
    assert.equal(post.channelSubscribers, 12_345);
    assert.equal(post.channelIsVerified, true);
    assert.equal(post.url, `https://t.me/${CHANNEL}/3`);
    assert.equal(post.scrapedAt, '2026-11-12T10:00:00.000Z');
    assert.deepEqual(Object.keys(post).slice(0, 8), ['channel', 'channelTitle', 'channelSubscribers', 'channelIsVerified', 'id', 'url', 'date', 'text']);
});

test('uses the rounded subscriber count when exact details are switched off', async () => {
    const { delivered, calls } = await scrape({ maxPosts: 1, includeChannelDetails: false }, { total: 3 });

    assert.equal(delivered[0].channelSubscribers, 12_300);
    assert.deepEqual(calls, [`/s/${CHANNEL}`]);
});

test('stops at the lower date bound and skips posts above the upper one', async () => {
    // The fake channel publishes post N on day N of 2026 at 12:00 UTC.
    const { result, ids } = await scrape({
        fromDate: new Date('2026-01-10T00:00:00.000Z'),
        toDate: new Date('2026-01-15T23:59:59.999Z'),
    }, { total: 40 });

    assert.deepEqual(ids, range(15, 10));
    assert.equal(result.stopReason, 'date');
    assert.equal(result.newestSeenId, 40);
});

test('monitoring: returns only posts newer than the last delivered one', async () => {
    const { result, ids, calls } = await scrape({ lastSeenId: 90 }, { total: 100 });

    assert.deepEqual(ids, range(100, 91));
    assert.equal(result.stopReason, 'seen');
    assert.equal(result.newestSeenId, 100);
    assert.equal(calls.filter((call) => call.startsWith('/s/')).length, 1);
});

test('monitoring: returns nothing when there is nothing new', async () => {
    const { result, ids } = await scrape({ lastSeenId: 100 }, { total: 100 });

    assert.deepEqual(ids, []);
    assert.equal(result.pushed, 0);
    assert.equal(result.stopReason, 'seen');
    assert.equal(result.newestSeenId, 100);
});

test('continues after an interruption without repeating delivered posts', async () => {
    const first = await scrape({ maxPosts: 50 }, { total: 100 });
    const midway = first.progress[1];
    assert.deepEqual(midway, { cursor: 61, pushed: 40, newestSeenId: 100 });

    const resumed = await scrape({ maxPosts: 50, resume: midway }, { total: 100 });

    assert.deepEqual(resumed.ids, range(60, 51));
    assert.equal(resumed.result.pushed, 50);
    assert.equal(resumed.result.newestSeenId, 100);
    assert.equal(resumed.result.stopReason, 'limit');
});

test('does nothing when a resumed channel had already reached its limit', async () => {
    const { result, ids, calls } = await scrape({ maxPosts: 40, resume: { cursor: 61, pushed: 40, newestSeenId: 100 } }, { total: 100 });

    assert.deepEqual(ids, []);
    assert.equal(result.stopReason, 'limit');
    assert.deepEqual(calls, []);
});

test('stops when the spending limit accepts only part of a batch', async () => {
    const fetchImpl = createFakeTelegram({ channel: CHANNEL, total: 100 });
    const delivered = [];
    let budget = 25;
    const result = await scrapeChannel({
        channel: CHANNEL,
        maxPosts: 100,
        pushPosts: async (posts) => {
            const accepted = posts.slice(0, budget);
            budget -= accepted.length;
            delivered.push(...accepted);
            return accepted.length;
        },
        fetchImpl,
    });

    assert.deepEqual(delivered.map((post) => post.id), range(100, 76));
    assert.equal(result.pushed, 25);
    assert.equal(result.stopReason, 'budget');
});

test('stops between pages when the run is about to hit its time limit', async () => {
    let pagesDone = 0;
    const { result, ids, progress } = await scrape({
        maxPosts: 1000,
        onProgress: () => { pagesDone++; },
        shouldStop: () => pagesDone >= 2,
    }, { total: 100 });

    assert.deepEqual(ids, range(100, 61));
    assert.equal(result.stopReason, 'timeout');
    assert.equal(result.pushed, 40);
    assert.equal(result.newestSeenId, 100);
    assert.deepEqual(progress, []);
});

test('a channel stopped by the time limit continues from the same place', async () => {
    const resumed = await scrape({ maxPosts: 1000, resume: { cursor: 61, pushed: 40, newestSeenId: 100 } }, { total: 100 });

    assert.deepEqual(resumed.ids, range(60, 1));
    assert.equal(resumed.result.pushed, 100);
    assert.equal(resumed.result.stopReason, 'end');
});

test('does not start a channel when the time is already up', async () => {
    const { result, ids, calls } = await scrape({ shouldStop: () => true }, { total: 100 });

    assert.deepEqual(ids, []);
    assert.equal(result.stopReason, 'timeout');
    assert.deepEqual(calls, []);
});

test('the natural end of a channel wins over the time limit', async () => {
    const { result, ids } = await scrape({ shouldStop: () => true, resume: null, maxPosts: 5, lastSeenId: null }, { total: 100 });
    assert.equal(result.stopReason, 'timeout');
    assert.deepEqual(ids, []);

    let asked = 0;
    const finished = await scrape({ maxPosts: 1000, shouldStop: () => { asked++; return asked > 1; } }, { total: 15 });
    assert.deepEqual(finished.ids, range(15, 1));
    assert.equal(finished.result.stopReason, 'end');
});

test('keywords keep only matching posts, across the whole channel, and say what matched', async () => {
    const mentions = { 5: 'A Privacy note', 17: 'new UPDATES today', 42: 'privacy and update', 77: 'nothing here', 90: 'Обновление приложения' };
    const { result, delivered, calls } = await scrape(
        { keywords: ['privacy', 'update', 'обновление'] },
        { total: 100, makePost: (id) => ({ html: mentions[id] ?? `Post ${id}` }) },
    );

    assert.deepEqual(delivered.map((post) => [post.id, post.matchedKeywords]), [
        [90, ['обновление']],
        [42, ['privacy', 'update']],
        [17, ['update']],
        [5, ['privacy']],
    ]);
    assert.equal(result.pushed, 4);
    assert.equal(result.stopReason, 'end');
    assert.equal(calls.filter((call) => call.startsWith('/s/')).length, 5);
});

test('keywords also look into polls, link previews and file names', async () => {
    const posts = {
        1: { html: null, poll: { question: 'Best browser?', voters: '10', options: [['Firefox', 50], ['Other', 50]] } },
        2: { html: 'See link', linkPreview: { url: 'https://example.com', siteName: 'Example', title: 'Firefox release', description: 'Notes', image: 'https://cdn.example/p.jpg' } },
        3: { html: 'Attached', document: { title: 'firefox-setup.zip', info: '1 MB' } },
        4: { html: 'Unrelated' },
    };
    const { ids } = await scrape({ keywords: ['firefox'] }, { total: 4, makePost: (id) => posts[id] });

    assert.deepEqual(ids, [3, 2, 1]);
});

test('the limit counts matching posts, not scanned ones', async () => {
    const { result, ids } = await scrape({ keywords: ['even'], maxPosts: 3 }, { total: 100, makePost: (id) => ({ html: id % 2 === 0 ? 'even post' : 'odd post' }) });

    assert.deepEqual(ids, [100, 98, 96]);
    assert.equal(result.stopReason, 'limit');
});

test('monitoring with keywords remembers every scanned post, not only the matches', async () => {
    const { result, ids } = await scrape({ keywords: ['rare'], lastSeenId: 80 }, { total: 100, makePost: (id) => ({ html: id === 85 ? 'a rare word' : 'usual' }) });

    assert.deepEqual(ids, [85]);
    assert.equal(result.newestSeenId, 100);
    assert.equal(result.stopReason, 'seen');
});

test('posts carry no keyword field when no keywords are set', async () => {
    const { delivered } = await scrape({ maxPosts: 1 }, { total: 1 });

    assert.equal('matchedKeywords' in delivered[0], false);
});

test('keeps Markdown and HTML when asked', async () => {
    const { delivered } = await scrape({ maxPosts: 1, includeMarkdown: true, includeHtml: true }, { total: 1, makePost: () => ({ html: '<b>Hi</b>' }) });

    assert.equal(delivered[0].text, 'Hi');
    assert.equal(delivered[0].markdown, '**Hi**');
    assert.equal(delivered[0].html, '<b>Hi</b>');
});

test('reports a channel without a public preview', async () => {
    await assert.rejects(
        scrapeChannel({ channel: 'someoneelse', maxPosts: 10, pushPosts: async () => 0, fetchImpl: createFakeTelegram({ channel: CHANNEL }) }),
        (error) => error instanceof ChannelUnavailableError && error.channel === 'someoneelse',
    );
});

test('fetchPage retries temporary failures and then succeeds', async () => {
    const statuses = [500, 429, 200];
    let attempts = 0;
    const fetchImpl = async () => {
        const status = statuses[attempts++];
        return new Response(status === 200 ? 'ok' : null, { status });
    };

    const page = await fetchPage('https://t.me/s/any', { fetchImpl, retryBaseDelayMs: 1 });

    assert.deepEqual(page, { status: 200, body: 'ok' });
    assert.equal(attempts, 3);
});

test('fetchPage retries network errors and gives up after five attempts', async () => {
    let attempts = 0;
    const fetchImpl = async () => { attempts++; throw new Error('socket hang up'); };

    await assert.rejects(fetchPage('https://t.me/s/any', { fetchImpl, retryBaseDelayMs: 1 }), /failed after 5 attempts: socket hang up/);
    assert.equal(attempts, 5);
});

test('fetchPage hands redirects back instead of following them', async () => {
    const fetchImpl = async (_url, init) => {
        assert.equal(init.redirect, 'manual');
        return new Response(null, { status: 302, headers: { location: 'https://t.me/any' } });
    };

    assert.deepEqual(await fetchPage('https://t.me/s/any', { fetchImpl }), { status: 302, body: '' });
});
