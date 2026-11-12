import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPusher } from '../src/pusher.js';

const posts = (count, offset = 0) => Array.from({ length: count }, (_, index) => ({ id: offset + index }));

test('stores everything when there is no spending limit', async () => {
    const stored = [];
    const pusher = createPusher({ remainingBudget: () => Infinity, pushData: async (batch) => { stored.push(...batch); } });

    assert.equal(await pusher.push(posts(20)), 20);
    assert.equal(await pusher.push(posts(7, 20)), 7);
    assert.equal(pusher.total, 27);
    assert.equal(pusher.exhausted, false);
    assert.equal(stored.length, 27);
});

test('cuts the batch that crosses the spending limit and stores nothing after it', async () => {
    const stored = [];
    let budget = 25;
    const pusher = createPusher({
        remainingBudget: () => budget,
        pushData: async (batch) => { stored.push(...batch); budget -= batch.length; },
    });

    assert.equal(await pusher.push(posts(20)), 20);
    assert.equal(pusher.exhausted, false);
    assert.equal(await pusher.push(posts(20, 20)), 5);
    assert.equal(pusher.exhausted, true);
    assert.equal(await pusher.push(posts(20, 40)), 0);
    assert.equal(pusher.total, 25);
    assert.deepEqual(stored.map((post) => post.id), posts(25).map((post) => post.id));
});

test('handles batches strictly one after another, in the order they were queued', async () => {
    const order = [];
    let budget = 30;
    const pusher = createPusher({
        remainingBudget: () => budget,
        pushData: async (batch) => {
            order.push(`start:${batch[0].id}`);
            await new Promise((resolve) => { setTimeout(resolve, batch[0].id === 0 ? 20 : 1); });
            budget -= batch.length;
            order.push(`end:${batch[0].id}`);
        },
    });

    const results = await Promise.all([pusher.push(posts(20)), pusher.push(posts(20, 100))]);

    assert.deepEqual(results, [20, 10]);
    assert.deepEqual(order, ['start:0', 'end:0', 'start:100', 'end:100']);
});

test('a failed write is reported to its caller and does not block later batches', async () => {
    let fail = true;
    const pusher = createPusher({
        remainingBudget: () => Infinity,
        pushData: async () => { if (fail) { fail = false; throw new Error('storage is down'); } },
    });

    await assert.rejects(pusher.push(posts(3)), /storage is down/);
    assert.equal(await pusher.push(posts(2)), 2);
    assert.equal(pusher.total, 2);
    await pusher.idle();
});
