import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readInput, stateKey } from '../src/input.js';
import { InputError } from '../src/utils.js';

const NOW = new Date('2026-11-12T10:00:00.000Z');

test('applies defaults', () => {
    const settings = readInput({ channels: ['telegram'] }, NOW);

    assert.deepEqual(settings, {
        channels: [{ input: 'telegram', username: 'telegram' }],
        rejected: [],
        maxPosts: 100,
        fromDate: null,
        toDate: null,
        keywords: [],
        onlyNewPosts: false,
        monitorId: 'default',
        includeMarkdown: false,
        includeHtml: false,
        includeChannelDetails: true,
    });
});

test('cleans the channel list: links, duplicates in any letter case, one string with separators', () => {
    const settings = readInput({ channels: ['@durov', 'https://t.me/s/telegram', 'DUROV', 'tginfo, contest\nnytimes'] }, NOW);

    assert.deepEqual(settings.channels.map((item) => item.username), ['durov', 'telegram', 'tginfo', 'contest', 'nytimes']);
    assert.deepEqual(readInput({ channels: 'durov telegram' }, NOW).channels.map((item) => item.username), ['durov', 'telegram']);
});

test('keeps valid channels and reports the ones it cannot use', () => {
    const settings = readInput({ channels: ['telegram', 'https://t.me/+AbCdEf', 'no'] }, NOW);

    assert.deepEqual(settings.channels.map((item) => item.username), ['telegram']);
    assert.deepEqual(settings.rejected.map((item) => item.input), ['https://t.me/+AbCdEf', 'no']);
});

test('refuses to start without a usable channel', () => {
    assert.throws(() => readInput({}, NOW), InputError);
    assert.throws(() => readInput({ channels: [] }, NOW), InputError);
    assert.throws(() => readInput({ channels: ['https://t.me/+AbCdEf'] }, NOW), /invite or service link/);
});

test('reads every option', () => {
    const settings = readInput({
        channels: ['telegram'],
        maxPostsPerChannel: 5,
        postsFrom: '7 days',
        postsTo: '2026-11-10',
        keywords: [' Privacy ', 'app update', 'PRIVACY'],
        onlyNewPosts: true,
        monitorId: 'brand-watch_1',
        includeMarkdown: true,
        includeHtml: true,
        includeChannelDetails: false,
    }, NOW);

    assert.equal(settings.maxPosts, 5);
    assert.equal(settings.fromDate.toISOString(), '2026-11-05T10:00:00.000Z');
    assert.equal(settings.toDate.toISOString(), '2026-11-10T23:59:59.999Z');
    assert.deepEqual(settings.keywords, ['privacy', 'app update']);
    assert.equal(settings.onlyNewPosts, true);
    assert.equal(settings.monitorId, 'brand-watch_1');
    assert.equal(settings.includeMarkdown, true);
    assert.equal(settings.includeHtml, true);
    assert.equal(settings.includeChannelDetails, false);
});

test('rejects values that cannot work', () => {
    const base = { channels: ['telegram'] };
    assert.throws(() => readInput({ ...base, maxPostsPerChannel: 0 }, NOW), /maxPostsPerChannel/);
    assert.throws(() => readInput({ ...base, maxPostsPerChannel: 2.5 }, NOW), /maxPostsPerChannel/);
    assert.throws(() => readInput({ ...base, postsFrom: 'someday' }, NOW), /postsFrom/);
    assert.throws(() => readInput({ ...base, postsFrom: '2026-11-11', postsTo: '2026-11-01' }, NOW), /later than/);
    assert.throws(() => readInput({ ...base, monitorId: 'has space' }, NOW), /monitorId/);
});

test('caps the per-channel limit', () => {
    assert.equal(readInput({ channels: ['telegram'], maxPostsPerChannel: 50_000_000 }, NOW).maxPosts, 1_000_000);
});

test('keywords may come as one string; phrases keep their spaces', () => {
    assert.deepEqual(readInput({ channels: ['telegram'], keywords: 'New York, app update\nПривет мир' }, NOW).keywords, ['new york', 'app update', 'привет мир']);
    assert.deepEqual(readInput({ channels: ['telegram'], keywords: ['', '  '] }, NOW).keywords, []);
});

test('stateKey ignores letter case', () => {
    assert.equal(stateKey('Durov'), 'durov');
});
