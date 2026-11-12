/**
 * Builds pages in the same markup Telegram uses for https://t.me/s/<channel>,
 * so tests run without network access and without copying anyone's posts.
 */

const escapeHtml = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * @param {string} channel
 * @param {object} post
 */
export function renderPost(channel, post) {
    const {
        id,
        date = '2026-01-01T00:00:00+00:00',
        html = `Post ${id}`,
        views = '1.2K',
        edited = false,
        author = null,
        forwardedFrom,
        replyTo,
        photos = [],
        video,
        document,
        poll,
        linkPreview,
        reactions = [],
        service = false,
        unsupported = false,
    } = post;

    const parts = [];
    if (forwardedFrom !== undefined) {
        const name = forwardedFrom?.url
            ? `<a class="tgme_widget_message_forwarded_from_name" href="${forwardedFrom.url}"><span dir="auto">${escapeHtml(forwardedFrom.name)}</span></a>`
            : `<span class="tgme_widget_message_forwarded_from_name"><span dir="auto">${escapeHtml(forwardedFrom?.name ?? '')}</span></span>`;
        parts.push(`<div class="tgme_widget_message_forwarded_from accent_color">Forwarded from&nbsp;${name}</div>`);
    }
    if (replyTo) {
        parts.push(`<a class="tgme_widget_message_reply user-color-12" href="https://t.me/${channel}/${replyTo.id}">
            <div class="tgme_widget_message_author accent_color"><span class="tgme_widget_message_author_name" dir="auto">${escapeHtml(replyTo.author)}</span></div>
            <div class="tgme_widget_message_text js-message_reply_text" dir="auto">${escapeHtml(replyTo.text)}</div></a>`);
    }
    for (const url of photos) {
        parts.push(`<a class="tgme_widget_message_photo_wrap" href="https://t.me/${channel}/${id}" style="width:800px;background-image:url('${url}')"><div class="tgme_widget_message_photo" style="padding-top:65%"></div></a>`);
    }
    if (video) {
        parts.push(`<a class="tgme_widget_message_video_player js-message_video_player" href="https://t.me/${channel}/${id}">
            <i class="tgme_widget_message_video_thumb" style="background-image:url('${video.thumbnail}')"></i>
            <div class="tgme_widget_message_video_wrap">${video.url ? `<video src="${video.url}" class="tgme_widget_message_video js-message_video"></video>` : ''}</div>
            <time class="message_video_duration js-message_video_duration">${video.duration}</time></a>`);
    }
    if (document) {
        parts.push(`<a class="tgme_widget_message_document_wrap" href="https://t.me/${channel}/${id}">
            <div class="tgme_widget_message_document_icon accent_bg${document.audio ? ' audio' : ''}"></div>
            <div class="tgme_widget_message_document"><div class="tgme_widget_message_document_title accent_color" dir="auto">${escapeHtml(document.title)}</div>
            <div class="tgme_widget_message_document_extra" dir="auto">${escapeHtml(document.info)}</div></div></a>`);
    }
    if (poll) {
        parts.push(`<div class="tgme_widget_message_poll js-poll"><div class="tgme_widget_message_poll_question">${escapeHtml(poll.question)}</div>
            <div class="tgme_widget_message_poll_type">Anonymous Poll</div><a class="tgme_widget_message_poll_options" href="https://t.me/${channel}/${id}">
            ${poll.options.map(([text, percent]) => `<div class="tgme_widget_message_poll_option"><div class="tgme_widget_message_poll_option_percent">${percent}%</div>
                <div class="tgme_widget_message_poll_option_value"><div class="tgme_widget_message_poll_option_text">${escapeHtml(text)}</div></div></div>`).join('')}</a></div>`);
    }
    if (html !== null && !unsupported) {
        parts.push(`<div class="tgme_widget_message_text js-message_text" dir="auto">${html}</div>`);
    }
    if (unsupported || html !== null) {
        // The real page carries this placeholder next to ordinary content too; it only matters when nothing else is there.
        parts.push(`<div class="message_media_not_supported_wrap"><div class="message_media_not_supported">
            <div class="message_media_not_supported_label">Please open Telegram to view this post</div>
            <a href="https://t.me/${channel}/${id}" class="message_media_view_in_telegram">VIEW IN TELEGRAM</a></div></div>`);
    }
    if (linkPreview) {
        parts.push(`<a class="tgme_widget_message_link_preview" href="${linkPreview.url}"><div class="link_preview_site_name accent_color" dir="auto">${escapeHtml(linkPreview.siteName)}</div>
            <i class="link_preview_image" style="background-image:url('${linkPreview.image}');padding-top:50%"></i>
            <div class="link_preview_title" dir="auto">${escapeHtml(linkPreview.title)}</div><div class="link_preview_description" dir="auto">${escapeHtml(linkPreview.description)}</div></a>`);
    }
    if (reactions.length) {
        parts.push(`<div class="tgme_widget_message_reactions js-message_reactions">${reactions.map((reaction) => {
            if (reaction.paid) return `<span class="tgme_reaction tgme_reaction_paid"><i class="icon icon-telegram-stars"></i>${reaction.count}</span>`;
            if (reaction.customId) return `<span class="tgme_reaction"><tg-emoji emoji-id="${reaction.customId}"></tg-emoji>${reaction.count}</span>`;
            return `<span class="tgme_reaction"><i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/x.png')"><b>${reaction.emoji}</b></i>${reaction.count}</span>`;
        }).join('')}</div>`);
    }

    const meta = [
        author ? `<span class="tgme_widget_message_from_author" dir="auto">${escapeHtml(author)}</span>,&nbsp;` : '',
        edited ? 'edited &nbsp;' : '',
        `<a class="tgme_widget_message_date" href="https://t.me/${channel}/${id}"><time datetime="${date}" class="time">12:00</time></a>`,
    ].join('');

    return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message${service ? ' service_message' : ''}" data-post="${channel}/${id}">
        <div class="tgme_widget_message_bubble">
            <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/${channel}"><span dir="auto">Channel</span></a></div>
            ${parts.join('\n')}
            <div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">
                ${poll ? `<span class="tgme_widget_message_voters">${poll.voters}</span><span class="copyonly"> voters</span>` : ''}
                <span class="tgme_widget_message_views">${views}</span><span class="copyonly"> views</span>
                <span class="tgme_widget_message_meta">${meta}</span></div></div>
        </div></div></div>`;
}

/**
 * @param {object} options
 * @param {string} options.channel
 * @param {object[]} options.posts            oldest first, as on the real page
 * @param {number | null} [options.olderCursor]
 * @param {number | null} [options.newerCursor]
 * @param {string} [options.title]
 * @param {string} [options.subscribers]
 * @param {boolean} [options.verified]
 */
export function renderChannelPage({ channel, posts, olderCursor = null, newerCursor = null, title = 'Test Channel', subscribers = '12.3K', verified = true }) {
    return `<!DOCTYPE html><html><body><main class="tgme_main">
        <div class="tgme_channel_info"><div class="tgme_channel_info_header">
            <i class="tgme_page_photo_image"><img src="https://cdn.example/photo.jpg"></i>
            <div class="tgme_channel_info_header_title_wrap"><div class="tgme_channel_info_header_title"><span dir="auto">${escapeHtml(title)}</span></div>
            <div class="tgme_channel_info_header_labels">${verified ? '<i class="verified-icon"> ✔</i>' : ''}</div></div>
            <div class="tgme_channel_info_header_username"><a href="https://t.me/${channel}">@${channel}</a></div></div>
            <div class="tgme_channel_info_counters">
                <div class="tgme_channel_info_counter"><span class="counter_value">${subscribers}</span> <span class="counter_type">subscribers</span></div>
                <div class="tgme_channel_info_counter"><span class="counter_value">104</span> <span class="counter_type">photos</span></div></div>
            <div class="tgme_channel_info_description">First line<br/>Second line</div></div>
        <section class="tgme_channel_history js-message_history">
            ${olderCursor != null ? `<div class="tgme_widget_message_centered js-messages_more_wrap"><a href="/s/${channel}?before=${olderCursor}" class="tme_messages_more js-messages_more" data-before="${olderCursor}"></a></div>` : ''}
            ${posts.map((post) => renderPost(channel, post)).join('\n')}
            ${newerCursor != null ? `<div class="tgme_widget_message_centered js-messages_more_wrap"><a href="/s/${channel}?after=${newerCursor}" class="tme_messages_more js-messages_more" data-after="${newerCursor}"></a></div>` : ''}
        </section></main></body></html>`;
}

/** The "View in Telegram" page with the exact subscriber count. */
export function renderAboutPage({ title = 'Test Channel', subscribers = '12 345 subscribers' } = {}) {
    return `<!DOCTYPE html><html><body><div class="tgme_page"><div class="tgme_page_title" dir="auto"><span dir="auto">${escapeHtml(title)}</span><i class="verified-icon"> ✔</i></div>
        <div class="tgme_page_extra">${subscribers}</div><div class="tgme_page_description" dir="auto">About text</div>
        <div class="tgme_page_context_link_wrap"><a class="tgme_page_context_link" href="/s/test">Preview channel</a></div></div></body></html>`;
}

/**
 * A stand-in for `fetch` that serves a fake channel with posts numbered 1..total,
 * one per day starting 2026-01-01, 20 per page like the real site.
 *
 * @param {object} options
 * @param {string} [options.channel]
 * @param {number} [options.total]
 * @param {(id: number) => object} [options.makePost]
 * @returns {typeof fetch & { calls: string[] }}
 */
export function createFakeTelegram({ channel = 'testchannel', total = 100, makePost = () => ({}) } = {}) {
    const calls = [];
    const dateOf = (id) => new Date(Date.UTC(2026, 0, id, 12)).toISOString().replace('.000Z', '+00:00');

    const fakeFetch = async (input) => {
        const url = new URL(String(input));
        calls.push(url.pathname + url.search);
        const respond = (status, body = '', headers = {}) => new Response(status === 200 ? body : null, { status, headers });

        if (url.pathname.toLowerCase() === `/${channel}`) return respond(200, renderAboutPage());
        if (url.pathname.toLowerCase() !== `/s/${channel}`) {
            return respond(302, '', { location: `https://t.me${url.pathname.replace('/s/', '/')}` });
        }

        const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Infinity;
        const pool = Array.from({ length: total }, (_, index) => index + 1).filter((id) => id < before);
        const pageIds = pool.slice(-20);
        const hasOlder = pool.length > pageIds.length;
        return respond(200, renderChannelPage({
            channel,
            posts: pageIds.map((id) => ({ id, date: dateOf(id), ...makePost(id) })),
            olderCursor: hasOlder ? pageIds[0] : null,
        }));
    };
    fakeFetch.calls = calls;
    return fakeFetch;
}
