import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import Ajv from 'ajv';

import { readInput } from '../src/input.js';
import { scrapeChannel } from '../src/scraper.js';
import { createFakeTelegram } from './helpers.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../.actor/${name}`, import.meta.url), 'utf8'));

const actor = readJson('actor.json');
const inputSchema = readJson('input_schema.json');
const datasetSchema = readJson('dataset_schema.json');
const outputSchema = readJson('output_schema.json');

/** Posts that together use every kind of field the parser can produce. */
const RICH_POSTS = {
    6: { unsupported: true },
    1: { html: null, poll: { question: 'Q?', voters: '1.5K', options: [['A', 60], ['B', 40]] } },
    2: { photos: ['https://cdn.example/1.jpg'], reactions: [{ paid: true, count: '3' }, { emoji: '👍', count: '1.1K' }, { customId: '77', count: '5' }] },
    3: { video: { url: null, thumbnail: 'https://cdn.example/t.jpg', duration: '0:20' }, forwardedFrom: null },
    4: { document: { title: 'File.zip', info: '1 MB' }, replyTo: { id: 2, author: 'Channel', text: 'Earlier' }, edited: true, author: 'Editor' },
    5: {
        html: '<b>Bold</b> <a href="?q=%23tag">#tag</a> <a href="https://t.me/someone">@someone</a> <a href="https://example.com/">site</a>',
        forwardedFrom: { name: 'Source', url: 'https://t.me/source/9' },
        linkPreview: { url: 'https://example.com/', siteName: 'Example', title: 'Title', description: 'Text', image: 'https://cdn.example/p.jpg' },
    },
};

async function produceItems(options = {}) {
    const items = [];
    await scrapeChannel({
        channel: 'testchannel',
        maxPosts: 50,
        includeMarkdown: true,
        includeHtml: true,
        pushPosts: async (posts) => { items.push(...posts); return posts.length; },
        fetchImpl: createFakeTelegram({ total: 6, makePost: (id) => RICH_POSTS[id] }),
        ...options,
    });
    return items;
}

test('every produced item passes the dataset schema', async () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(datasetSchema.fields);
    const items = [...await produceItems(), ...await produceItems({ keywords: ['post', 'bold', 'q?'], includeMarkdown: false, includeHtml: false, includeChannelDetails: false })];

    assert.equal(items.length, 6 + 5);
    assert.ok(items.some((item) => item.matchedKeywords?.length === 1));
    for (const item of items) {
        assert.ok(validate(item), `post ${item.id}: ${JSON.stringify(validate.errors)}`);
    }
});

test('the dataset schema describes every field an item can have', async () => {
    const described = new Set(Object.keys(datasetSchema.fields.properties));
    for (const item of await produceItems({ keywords: ['post', 'bold', 'q?'] })) {
        for (const key of Object.keys(item)) assert.ok(described.has(key), `"${key}" is missing in dataset_schema.json`);
    }
});

test('dataset views only show fields that exist', () => {
    const described = new Set(Object.keys(datasetSchema.fields.properties));
    for (const [name, view] of Object.entries(datasetSchema.views)) {
        for (const field of view.transformation.fields) assert.ok(described.has(field), `view "${name}" shows unknown field "${field}"`);
        for (const field of Object.keys(view.display.properties)) assert.ok(view.transformation.fields.includes(field), `view "${name}" formats "${field}" but does not show it`);
    }
});

test('the example input from the schema is accepted and stays small enough for the daily health check', () => {
    const example = Object.fromEntries(Object.entries(inputSchema.properties)
        .filter(([, field]) => field.prefill !== undefined)
        .map(([key, field]) => [key, field.prefill]));

    for (const key of inputSchema.required) assert.ok(key in example, `required field "${key}" needs a prefill`);
    const settings = readInput(example);
    assert.deepEqual(settings.channels.map((item) => item.username), ['telegram']);
    assert.ok(settings.maxPosts <= 50);
});

test('input defaults in the schema match the defaults in the code', () => {
    const defaults = Object.fromEntries(Object.entries(inputSchema.properties)
        .filter(([, field]) => field.default !== undefined)
        .map(([key, field]) => [key, field.default]));
    const fromSchema = readInput({ channels: ['telegram'], ...defaults });
    const fromCode = readInput({ channels: ['telegram'] });

    assert.deepEqual(fromSchema, fromCode);
});

test('input patterns accept what the form produces and what the code understands', () => {
    const from = new RegExp(inputSchema.properties.postsFrom.pattern);
    for (const value of ['2026-01-31', '7 days', '1 week', '2 months', '1 year', '36 hours', '2026-01-31T08:00:00Z']) assert.ok(from.test(value), value);
    for (const value of ['yesterday', '31-01-2026', '7']) assert.ok(!from.test(value), value);

    const until = new RegExp(inputSchema.properties.postsTo.pattern);
    assert.ok(until.test('2026-01-31'));
    assert.ok(!until.test('7 days'));

    const monitor = new RegExp(inputSchema.properties.monitorId.pattern);
    assert.ok(monitor.test('brand-watch_1'));
    assert.ok(!monitor.test('has space'));
});

test('actor.json points to files that exist and the output schema is complete', () => {
    for (const path of [actor.input, actor.output, actor.storages.dataset, actor.dockerfile, actor.readme]) {
        assert.doesNotThrow(() => readFileSync(new URL(`../.actor/${path}`, import.meta.url)), path);
    }
    assert.equal(actor.actorSpecification, 1);
    assert.match(actor.version, /^\d+\.\d+$/);
    assert.equal(outputSchema.actorOutputSchemaVersion, 1);
    for (const [name, output] of Object.entries(outputSchema.properties)) {
        assert.ok(output.title && output.template, `output "${name}" needs a title and a template`);
    }
});
