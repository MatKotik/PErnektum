/**
 * Turns the public web preview of a Telegram channel (https://t.me/s/<channel>)
 * into structured data. Pure functions only: HTML in, plain objects out.
 */
import * as cheerio from 'cheerio';

import { parseCount, parseDuration, urlFromStyle } from './utils.js';

const BLOCK_TAGS = new Set(['blockquote', 'pre', 'div', 'p']);

/** Collapses the whitespace noise left after flattening HTML, keeping intentional line breaks. */
function tidy(text) {
    return text
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Plain text of a message body with line breaks preserved.
 *
 * @param {cheerio.CheerioAPI} $
 * @param {import('domhandler').AnyNode} root
 */
function toPlainText($, root) {
    const walk = (node) => {
        if (node.type === 'text') return node.data;
        if (node.type !== 'tag') return '';
        if (node.name === 'br') return '\n';
        const inner = node.children.map(walk).join('');
        return BLOCK_TAGS.has(node.name) ? `\n${inner}\n` : inner;
    };
    return tidy(root.children.map(walk).join(''));
}

/** Wraps `inner` in a Markdown marker while keeping surrounding whitespace outside of it. */
function wrapMarkdown(inner, marker) {
    const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match[2]) return inner;
    return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

/**
 * Markdown rendering of a message body (bold, italic, strikethrough, code, links, quotes, spoilers).
 *
 * @param {cheerio.CheerioAPI} $
 * @param {import('domhandler').AnyNode} root
 * @param {string} baseUrl
 */
function toMarkdown($, root, baseUrl) {
    const walk = (node) => {
        if (node.type === 'text') return node.data;
        if (node.type !== 'tag') return '';
        if (node.name === 'br') return '\n';
        if (node.name === 'pre') return `\n\`\`\`\n${$(node).text()}\n\`\`\`\n`;
        if (node.name === 'code') return `\`${$(node).text()}\``;

        const inner = node.children.map(walk).join('');
        switch (node.name) {
            case 'b':
            case 'strong':
                // Emoji are rendered as <i class="emoji"><b>…</b></i>; keep them as plain characters.
                return node.parent?.attribs?.class?.includes('emoji') ? inner : wrapMarkdown(inner, '**');
            case 'i':
            case 'em':
                return node.attribs.class?.includes('emoji') ? inner : wrapMarkdown(inner, '_');
            case 's':
            case 'del':
                return wrapMarkdown(inner, '~~');
            case 'tg-spoiler':
                return wrapMarkdown(inner, '||');
            case 'blockquote':
                return `\n${tidy(inner).split('\n').map((line) => `> ${line}`).join('\n')}\n`;
            case 'a': {
                const href = absoluteUrl(node.attribs.href, baseUrl);
                const label = inner.trim();
                if (!href || !label || href === label || href.includes('?q=%23')) return inner;
                return `[${label}](${href})`;
            }
            default:
                return inner;
        }
    };
    return tidy(root.children.map(walk).join(''));
}

/** Resolves protocol-relative and relative links against the channel preview URL. */
function absoluteUrl(href, baseUrl) {
    if (!href) return null;
    try {
        return new URL(href, baseUrl).toString();
    } catch {
        return null;
    }
}

/** Text that belongs directly to the element, ignoring text of its children. */
function ownText($, el) {
    return $(el).contents().filter((_, node) => node.type === 'text').text().trim();
}

/**
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<any>} $message
 */
function parseReactions($, $message) {
    const reactions = [];
    $message.find('.tgme_widget_message_reactions .tgme_reaction').each((_, el) => {
        const $el = $(el);
        const count = parseCount(ownText($, el));
        if ($el.hasClass('tgme_reaction_paid')) {
            reactions.push({ type: 'paid', emoji: '⭐', customEmojiId: null, count });
            return;
        }
        const emoji = $el.find('.emoji b').first().text().trim() || $el.find('.emoji').first().text().trim() || null;
        const customEmojiId = $el.find('tg-emoji').attr('emoji-id') ?? null;
        reactions.push({ type: emoji ? 'emoji' : 'custom', emoji, customEmojiId: emoji ? null : customEmojiId, count });
    });
    return reactions;
}

/**
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<any>} $message
 */
function parseMedia($, $message, baseUrl) {
    const photos = [];
    $message.find('.tgme_widget_message_photo_wrap').each((_, el) => {
        const url = urlFromStyle($(el).attr('style'));
        if (url) photos.push(url);
    });

    const videos = [];
    $message.find('.tgme_widget_message_video_player, .tgme_widget_message_roundvideo_player').each((_, el) => {
        const $el = $(el);
        const durationText = $el.find('.message_video_duration, .message_roundvideo_duration').first().text().trim() || null;
        videos.push({
            url: $el.find('video').attr('src') ?? null,
            thumbnailUrl: urlFromStyle($el.find('.tgme_widget_message_video_thumb, .tgme_widget_message_roundvideo_thumb').attr('style')),
            duration: durationText,
            durationSeconds: parseDuration(durationText),
        });
    });

    const documents = [];
    $message.find('.tgme_widget_message_document_wrap').each((_, el) => {
        const $el = $(el);
        documents.push({
            title: $el.find('.tgme_widget_message_document_title').text().trim() || null,
            info: $el.find('.tgme_widget_message_document_extra').text().trim() || null,
            isAudio: $el.find('.tgme_widget_message_document_icon').hasClass('audio'),
        });
    });

    const voiceMessages = [];
    $message.find('.tgme_widget_message_voice_player').each((_, el) => {
        const $el = $(el);
        const durationText = $el.find('.tgme_widget_message_voice_duration').first().text().trim() || null;
        voiceMessages.push({
            url: $el.find('audio').attr('src') ?? null,
            duration: durationText,
            durationSeconds: parseDuration(durationText),
        });
    });

    let poll = null;
    const $poll = $message.find('.tgme_widget_message_poll').first();
    if ($poll.length) {
        poll = {
            question: toPlainText($, $poll.find('.tgme_widget_message_poll_question').get(0) ?? $poll.get(0)),
            type: $poll.find('.tgme_widget_message_poll_type').text().trim() || null,
            voters: parseCount($message.find('.tgme_widget_message_voters').first().text()),
            options: $poll.find('.tgme_widget_message_poll_option').map((_, el) => ({
                text: $(el).find('.tgme_widget_message_poll_option_text').text().trim(),
                percent: parseCount($(el).find('.tgme_widget_message_poll_option_percent').text()),
            })).get(),
        };
    }

    let linkPreview = null;
    const $preview = $message.find('.tgme_widget_message_link_preview').first();
    if ($preview.length) {
        linkPreview = {
            url: absoluteUrl($preview.attr('href'), baseUrl),
            siteName: $preview.find('.link_preview_site_name').text().trim() || null,
            title: $preview.find('.link_preview_title').text().trim() || null,
            description: $preview.find('.link_preview_description').text().trim() || null,
            imageUrl: urlFromStyle($preview.find('.link_preview_image, .link_preview_right_image').attr('style')),
        };
    }

    const hasSticker = $message.find('.tgme_widget_message_sticker_wrap').length > 0;
    const hasLocation = $message.find('.tgme_widget_message_location_wrap').length > 0;

    const mediaTypes = [];
    if (photos.length) mediaTypes.push('photo');
    if (videos.length) mediaTypes.push('video');
    if (documents.some((doc) => !doc.isAudio)) mediaTypes.push('document');
    if (documents.some((doc) => doc.isAudio)) mediaTypes.push('audio');
    if (voiceMessages.length) mediaTypes.push('voice');
    if (poll) mediaTypes.push('poll');
    if (hasSticker) mediaTypes.push('sticker');
    if (hasLocation) mediaTypes.push('location');

    return { photos, videos, documents, voiceMessages, poll, linkPreview, mediaTypes };
}

/**
 * @param {cheerio.CheerioAPI} $
 * @param {import('domhandler').Element} el  the `.tgme_widget_message` element
 * @param {{ baseUrl: string, includeMarkdown?: boolean, includeHtml?: boolean }} options
 */
function parsePost($, el, { baseUrl, includeMarkdown = false, includeHtml = false }) {
    const $message = $(el);
    const [channel, idText] = String($message.attr('data-post') ?? '').split('/');
    const id = Number(idText);
    if (!channel || !Number.isInteger(id)) return null;

    const $date = $message.find('.tgme_widget_message_date').last();
    const dateAttr = $date.find('time').attr('datetime');
    const date = dateAttr ? new Date(dateAttr) : null;

    const textEl = $message.find('.tgme_widget_message_text.js-message_text').get(0);
    const text = textEl ? toPlainText($, textEl) : '';

    const hashtags = new Set();
    const mentions = new Set();
    const links = new Set();
    if (textEl) {
        $(textEl).find('a').each((_, a) => {
            const href = $(a).attr('href') ?? '';
            const label = $(a).text().trim();
            if (href.startsWith('?q=%23') || (label.startsWith('#') && href.includes('?q='))) {
                hashtags.add(label);
            } else if (label.startsWith('@') && /^https?:\/\/t\.me\/[A-Za-z0-9_]+\/?$/.test(href)) {
                mentions.add(label);
            } else {
                const url = absoluteUrl(href, baseUrl);
                if (url && /^https?:/i.test(url)) links.add(url);
            }
        });
    }

    const buttons = $message.find('.tgme_widget_message_inline_button').map((_, a) => ({
        text: $(a).text().trim(),
        url: absoluteUrl($(a).attr('href'), baseUrl),
    })).get();

    const $forwarded = $message.find('.tgme_widget_message_forwarded_from_name').first();
    const forwardedFrom = $forwarded.length
        ? { name: $forwarded.text().trim() || null, url: absoluteUrl($forwarded.attr('href'), baseUrl) }
        : null;

    const $reply = $message.find('a.tgme_widget_message_reply').first();
    let replyTo = null;
    if ($reply.length) {
        const replyUrl = absoluteUrl($reply.attr('href'), baseUrl);
        const replyId = Number(replyUrl?.match(/\/(\d+)(?:\?.*)?$/)?.[1]);
        replyTo = {
            id: Number.isInteger(replyId) ? replyId : null,
            url: replyUrl,
            author: $reply.find('.tgme_widget_message_author_name').text().trim() || null,
            text: $reply.find('.js-message_reply_text').text().trim() || null,
        };
    }

    const media = parseMedia($, $message, baseUrl);
    const reactions = parseReactions($, $message);
    const metaText = $message.find('.tgme_widget_message_meta').text();
    // Telegram shows a "Please open Telegram to view this post" placeholder for content the web cannot render.
    const isUnsupported = !text && media.mediaTypes.length === 0 && !media.linkPreview
        && $message.find('.message_media_not_supported').length > 0;

    const post = {
        channel,
        id,
        url: `https://t.me/${channel}/${id}`,
        date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
        text,
        views: parseCount($message.find('.tgme_widget_message_views').first().text()),
        reactions,
        reactionsCount: reactions.reduce((sum, reaction) => sum + (reaction.count ?? 0), 0),
        isEdited: /\bedited\b/i.test(metaText),
        isUnsupported,
        author: $message.find('.tgme_widget_message_from_author').first().text().trim() || null,
        isForwarded: forwardedFrom !== null,
        forwardedFrom,
        replyTo,
        hashtags: [...hashtags],
        mentions: [...mentions],
        links: [...links],
        buttons,
        ...media,
    };
    if (includeMarkdown) post.markdown = textEl ? toMarkdown($, textEl, baseUrl) : '';
    if (includeHtml) post.html = textEl ? ($(textEl).html() ?? '').trim() : '';
    return post;
}

/**
 * Parses one page of https://t.me/s/<channel>.
 *
 * @param {string} html
 * @param {{ baseUrl?: string, includeMarkdown?: boolean, includeHtml?: boolean }} [options]
 * @returns {{
 *   isChannelPreview: boolean,
 *   channel: { username: string | null, title: string | null, description: string | null, isVerified: boolean,
 *              photoUrl: string | null, subscribers: number | null, counters: Record<string, number | null> } | null,
 *   posts: object[],
 *   olderCursor: number | null,
 *   newerCursor: number | null,
 * }}
 */
export function parseChannelPage(html, options = {}) {
    const baseUrl = options.baseUrl ?? 'https://t.me/s/';
    const $ = cheerio.load(html);

    const $info = $('.tgme_channel_info').first();
    const isChannelPreview = $info.length > 0 || $('.tgme_channel_history').length > 0;
    if (!isChannelPreview) {
        return { isChannelPreview: false, channel: null, posts: [], olderCursor: null, newerCursor: null };
    }

    const counters = {};
    $info.find('.tgme_channel_info_counter').each((_, el) => {
        const type = $(el).find('.counter_type').text().trim().toLowerCase();
        if (type) counters[type] = parseCount($(el).find('.counter_value').text());
    });
    const descriptionEl = $info.find('.tgme_channel_info_description').get(0);
    const channel = {
        username: $info.find('.tgme_channel_info_header_username a').text().trim().replace(/^@/, '') || null,
        title: $info.find('.tgme_channel_info_header_title').text().trim() || null,
        description: descriptionEl ? toPlainText($, descriptionEl) : null,
        isVerified: $info.find('.tgme_channel_info_header_labels .verified-icon').length > 0,
        photoUrl: $info.find('.tgme_channel_info_header img').attr('src') ?? null,
        subscribers: counters.subscribers ?? counters.subscriber ?? null,
        counters,
    };

    const posts = [];
    $('.tgme_widget_message_wrap .tgme_widget_message[data-post]').each((_, el) => {
        if ($(el).hasClass('service_message')) return;
        const post = parsePost($, el, { ...options, baseUrl });
        if (post) posts.push(post);
    });

    const cursor = (attr) => {
        const value = Number($(`a.js-messages_more[data-${attr}]`).first().attr(`data-${attr}`));
        return Number.isInteger(value) ? value : null;
    };

    return { isChannelPreview: true, channel, posts, olderCursor: cursor('before'), newerCursor: cursor('after') };
}

/**
 * Parses https://t.me/<channel> (the "View in Telegram" page), which carries the exact subscriber count.
 *
 * @param {string} html
 * @returns {{ title: string | null, description: string | null, isVerified: boolean,
 *             subscribers: number | null, hasPreview: boolean }}
 */
export function parseAboutPage(html) {
    const $ = cheerio.load(html);
    const extra = $('.tgme_page_extra').first().text().trim();
    const subscribers = extra.match(/([\d\s  .,]+)\s*(subscribers?|members?)/i);
    const descriptionEl = $('.tgme_page_description').get(0);
    return {
        title: ownText($, $('.tgme_page_title span').first().get(0) ?? $('.tgme_page_title').get(0)) || $('.tgme_page_title').text().trim() || null,
        description: descriptionEl ? toPlainText($, descriptionEl) : null,
        isVerified: $('.tgme_page_title .verified-icon').length > 0,
        subscribers: subscribers ? parseCount(subscribers[1].replace(/[.,]/g, '')) : null,
        hasPreview: $('.tgme_page_context_link').length > 0,
    };
}
