import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InputError, normalizeChannel, parseCount, parseDateBound, parseDuration, runWithConcurrency, urlFromStyle } from '../src/utils.js';

test('normalizeChannel accepts usernames and every common link form', () => {
    const accepted = [
        'durov', '@durov', ' durov ', 't.me/durov', 'https://t.me/durov', 'http://t.me/durov/', 'https://t.me/s/durov',
        'https://t.me/durov/552', 'https://t.me/s/durov?before=100', 'https://telegram.me/durov', '//t.me/durov', 'tg://resolve?domain=durov',
    ];
    for (const value of accepted) assert.equal(normalizeChannel(value), 'durov', value);
    assert.equal(normalizeChannel('Tass_Agency'), 'Tass_Agency');
});

test('normalizeChannel rejects invite links, other sites and malformed names', () => {
    const rejected = [
        '', '   ', 'https://t.me/+AbCdEf123', 'https://t.me/joinchat/AbCdEf', 'https://example.com/durov', 't.me/c/123456/7',
        'ab', '1channel', 'has space', 'bad-name', 'x'.repeat(40), 'https://t.me/',
    ];
    for (const value of rejected) assert.throws(() => normalizeChannel(value), InputError, `should reject "${value}"`);
});

test('parseCount expands Telegram counters', () => {
    assert.equal(parseCount('635K'), 635_000);
    assert.equal(parseCount('6.83M'), 6_830_000);
    assert.equal(parseCount('1.2B'), 1_200_000_000);
    assert.equal(parseCount('256'), 256);
    assert.equal(parseCount('10 043 167'), 10_043_167);
    assert.equal(parseCount('34%'), 34);
    assert.equal(parseCount(''), null);
    assert.equal(parseCount(undefined), null);
    assert.equal(parseCount('views'), null);
});

test('parseDuration converts clock strings to seconds', () => {
    assert.equal(parseDuration('0:20'), 20);
    assert.equal(parseDuration('1:15'), 75);
    assert.equal(parseDuration('1:02:03'), 3723);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('soon'), null);
});

test('urlFromStyle extracts background images', () => {
    assert.equal(urlFromStyle("width:800px;background-image:url('https://cdn.example/a.jpg')"), 'https://cdn.example/a.jpg');
    assert.equal(urlFromStyle('background-image:url("//cdn.example/a.jpg");padding-top:50%'), 'https://cdn.example/a.jpg');
    assert.equal(urlFromStyle("background-image:url('data:image/svg+xml;base64,AAAA')"), null);
    assert.equal(urlFromStyle('width:10px'), null);
    assert.equal(urlFromStyle(undefined), null);
});

test('parseDateBound understands dates and relative periods', () => {
    const now = new Date('2026-11-12T10:00:00.000Z');
    assert.equal(parseDateBound('2026-11-01', { now }).toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(parseDateBound('2026-11-01', { now, endOfDay: true }).toISOString(), '2026-11-01T23:59:59.999Z');
    assert.equal(parseDateBound('2026-11-01T08:30:00Z', { now }).toISOString(), '2026-11-01T08:30:00.000Z');
    assert.equal(parseDateBound('7 days', { now }).toISOString(), '2026-11-05T10:00:00.000Z');
    assert.equal(parseDateBound('1 week', { now }).toISOString(), '2026-11-05T10:00:00.000Z');
    assert.equal(parseDateBound('36 hours', { now }).toISOString(), '2026-11-10T22:00:00.000Z');
    assert.equal(parseDateBound('', { now }), null);
    assert.equal(parseDateBound(undefined, { now }), null);
    assert.throws(() => parseDateBound('yesterday', { now, field: 'postsFrom' }), /postsFrom/);
    assert.throws(() => parseDateBound('2026-13-45', { now }), InputError);
});

test('runWithConcurrency never runs more than the limit at once and visits every item', async () => {
    let running = 0;
    let peak = 0;
    const seen = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        seen.push(item);
        running--;
    });
    assert.equal(peak, 3);
    assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
});
