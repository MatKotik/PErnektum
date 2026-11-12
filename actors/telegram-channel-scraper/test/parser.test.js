import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAboutPage, parseChannelPage } from '../src/parser.js';
import { renderAboutPage, renderChannelPage } from './helpers.js';

const CHANNEL = 'testchannel';

const parseOne = (post, options) => {
    const page = parseChannelPage(renderChannelPage({ channel: CHANNEL, posts: [post] }), options);
    assert.equal(page.posts.length, 1);
    return page.posts[0];
};

test('reads channel details and paging cursors', () => {
    const page = parseChannelPage(renderChannelPage({
        channel: CHANNEL,
        posts: [{ id: 41 }, { id: 42 }],
        olderCursor: 41,
        newerCursor: 42,
        title: 'News & Co',
        subscribers: '9.14M',
    }));

    assert.equal(page.isChannelPreview, true);
    assert.deepEqual(page.channel, {
        username: CHANNEL,
        title: 'News & Co',
        description: 'First line\nSecond line',
        isVerified: true,
        photoUrl: 'https://cdn.example/photo.jpg',
        subscribers: 9_140_000,
        counters: { subscribers: 9_140_000, photos: 104 },
    });
    assert.equal(page.olderCursor, 41);
    assert.equal(page.newerCursor, 42);
    assert.deepEqual(page.posts.map((post) => post.id), [41, 42]);
});

test('reads the basic fields of a post', () => {
    const post = parseOne({ id: 7, date: '2026-03-04T05:06:07+00:00', html: 'Hello<br/>world', views: '635K', edited: true, author: 'Editor' });

    assert.equal(post.channel, CHANNEL);
    assert.equal(post.id, 7);
    assert.equal(post.url, `https://t.me/${CHANNEL}/7`);
    assert.equal(post.date, '2026-03-04T05:06:07.000Z');
    assert.equal(post.text, 'Hello\nworld');
    assert.equal(post.views, 635_000);
    assert.equal(post.isEdited, true);
    assert.equal(post.isUnsupported, false);
    assert.equal(post.author, 'Editor');
    assert.equal(post.isForwarded, false);
    assert.equal(post.forwardedFrom, null);
    assert.equal(post.replyTo, null);
    assert.deepEqual(post.mediaTypes, []);
    assert.equal('markdown' in post, false);
    assert.equal('html' in post, false);
});

test('separates hashtags, mentions and links, and keeps emoji as characters', () => {
    const html = '<tg-emoji emoji-id="1"><i class="emoji" style="background-image:url(\'//telegram.org/img/emoji/40/x.png\')"><b>✨</b></i></tg-emoji> '
        + '<b>Big</b> news from <a href="https://t.me/designers" target="_blank">@designers</a> '
        + '<a href="?q=%23launch">#launch</a> see <a href="https://example.com/a?b=1" target="_blank">the site</a> '
        + 'and <a href="https://example.com/a?b=1">again</a>';
    const post = parseOne({ id: 1, html });

    assert.equal(post.text, '✨ Big news from @designers #launch see the site and again');
    assert.deepEqual(post.hashtags, ['#launch']);
    assert.deepEqual(post.mentions, ['@designers']);
    assert.deepEqual(post.links, ['https://example.com/a?b=1']);
});

test('renders Markdown and HTML only on request', () => {
    const html = '<b>Bold</b> and <i>italic</i> and <s>gone</s> <code>x = 1</code><br/><blockquote>quoted<br/>twice</blockquote>'
        + '<a href="https://example.com/">link</a> <tg-spoiler>secret</tg-spoiler>';
    const post = parseOne({ id: 1, html }, { includeMarkdown: true, includeHtml: true });

    assert.equal(post.markdown, '**Bold** and _italic_ and ~~gone~~ `x = 1`\n\n> quoted\n> twice\n[link](https://example.com/) ||secret||');
    assert.equal(post.html, html.replaceAll('<br/>', '<br>'));
    assert.equal(post.text, 'Bold and italic and gone x = 1\n\nquoted\ntwice\nlink secret');
});

test('reads photos, video, documents and link previews', () => {
    const post = parseOne({
        id: 2,
        photos: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
        video: { url: 'https://cdn.example/v.mp4', thumbnail: 'https://cdn.example/t.jpg', duration: '1:15' },
        document: { title: 'Report.pdf', info: '14.4 KB' },
        linkPreview: { url: 'https://example.com/story', siteName: 'Example', title: 'A story', description: 'About it', image: 'https://cdn.example/p.jpg' },
    });

    assert.deepEqual(post.photos, ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg']);
    assert.deepEqual(post.videos, [{ url: 'https://cdn.example/v.mp4', thumbnailUrl: 'https://cdn.example/t.jpg', duration: '1:15', durationSeconds: 75 }]);
    assert.deepEqual(post.documents, [{ title: 'Report.pdf', info: '14.4 KB', isAudio: false }]);
    assert.deepEqual(post.linkPreview, {
        url: 'https://example.com/story', siteName: 'Example', title: 'A story', description: 'About it', imageUrl: 'https://cdn.example/p.jpg',
    });
    assert.deepEqual(post.mediaTypes, ['photo', 'video', 'document']);
});

test('keeps a video without a playable file and marks audio documents', () => {
    const post = parseOne({
        id: 3,
        video: { url: null, thumbnail: 'https://cdn.example/t.jpg', duration: '2:01:05' },
        document: { title: 'Podcast', info: 'Studio', audio: true },
    });

    assert.deepEqual(post.videos, [{ url: null, thumbnailUrl: 'https://cdn.example/t.jpg', duration: '2:01:05', durationSeconds: 7265 }]);
    assert.deepEqual(post.mediaTypes, ['video', 'audio']);
});

test('reads polls with their voter count', () => {
    const post = parseOne({ id: 4, html: null, poll: { question: 'Like it?', voters: '8.44K', options: [['Yes', 66], ['No', 34]] } });

    assert.equal(post.text, '');
    assert.deepEqual(post.poll, {
        question: 'Like it?',
        type: 'Anonymous Poll',
        voters: 8440,
        options: [{ text: 'Yes', percent: 66 }, { text: 'No', percent: 34 }],
    });
    assert.deepEqual(post.mediaTypes, ['poll']);
});

test('reads standard, custom and paid reactions', () => {
    const post = parseOne({
        id: 5,
        reactions: [{ paid: true, count: '11.6K' }, { emoji: '👍', count: '256' }, { customId: '5399847211989246390', count: '17.2K' }],
    });

    assert.deepEqual(post.reactions, [
        { type: 'paid', emoji: '⭐', customEmojiId: null, count: 11_600 },
        { type: 'emoji', emoji: '👍', customEmojiId: null, count: 256 },
        { type: 'custom', emoji: null, customEmojiId: '5399847211989246390', count: 17_200 },
    ]);
    assert.equal(post.reactionsCount, 11_600 + 256 + 17_200);
});

test('reads forwards and replies without mixing the quoted text into the post', () => {
    const post = parseOne({
        id: 6,
        html: 'My own words',
        forwardedFrom: { name: 'Source Channel', url: 'https://t.me/source/55' },
        replyTo: { id: 3, author: 'Channel', text: 'The earlier post' },
    });

    assert.equal(post.text, 'My own words');
    assert.equal(post.isForwarded, true);
    assert.deepEqual(post.forwardedFrom, { name: 'Source Channel', url: 'https://t.me/source/55' });
    assert.deepEqual(post.replyTo, { id: 3, url: `https://t.me/${CHANNEL}/3`, author: 'Channel', text: 'The earlier post' });
});

test('reports a forward whose source is hidden', () => {
    const post = parseOne({ id: 8, forwardedFrom: null });

    assert.equal(post.isForwarded, true);
    assert.deepEqual(post.forwardedFrom, { name: null, url: null });
});

test('flags posts whose content Telegram does not show on the web', () => {
    const hidden = parseOne({ id: 9, unsupported: true, views: '199K', reactions: [{ emoji: '🔥', count: '2' }] });

    assert.equal(hidden.isUnsupported, true);
    assert.equal(hidden.text, '');
    assert.equal(hidden.views, 199_000);
    assert.equal(hidden.reactionsCount, 2);

    assert.equal(parseOne({ id: 10, html: 'Ordinary post' }).isUnsupported, false);
    assert.equal(parseOne({ id: 11, html: null, photos: ['https://cdn.example/1.jpg'] }).isUnsupported, false);
});

test('skips service messages', () => {
    const page = parseChannelPage(renderChannelPage({ channel: CHANNEL, posts: [{ id: 1, service: true }, { id: 2 }] }));

    assert.deepEqual(page.posts.map((post) => post.id), [2]);
});

test('recognises a page that is not a channel preview', () => {
    const page = parseChannelPage('<html><body><div class="tgme_page"><div class="tgme_page_title">Someone</div></div></body></html>');

    assert.equal(page.isChannelPreview, false);
    assert.deepEqual(page.posts, []);
});

test('reads the exact subscriber count from the about page', () => {
    assert.deepEqual(parseAboutPage(renderAboutPage({ title: 'Pavel', subscribers: '10 043 167 subscribers' })), {
        title: 'Pavel',
        description: 'About text',
        isVerified: true,
        subscribers: 10_043_167,
        hasPreview: true,
    });
    assert.equal(parseAboutPage(renderAboutPage({ subscribers: '1 subscriber' })).subscribers, 1);
    assert.equal(parseAboutPage(renderAboutPage({ subscribers: '' })).subscribers, null);
});
