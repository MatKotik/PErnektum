# Telegram Channel Scraper & Monitor

Export posts from any **public Telegram channel** as clean JSON, CSV or Excel: text, date, views, reactions, photos, videos, polls, links, hashtags and forwards. Run it once to download a channel's history, or schedule it in **monitoring mode** and receive only the posts published since the previous run.

No Telegram account, no phone number, no API key and no bot token. Enter channel names and press **Start**.

## What does Telegram Channel Scraper do?

- 📥 **Exports channel history**: from the newest post back to the first one, with a limit you choose.
- 🔔 **Monitors channels**: remembers the last post it delivered and returns only new posts on the next run.
- 🔎 **Filters by keywords**: reads the channel and returns only posts that mention your words or phrases. You pay only for matching posts.
- 📅 **Filters by date**: a fixed range or a period such as the last 7 days.
- 🧾 **Returns structured data**: reactions with counters, polls with results, media links, link previews, replies and forward sources.
- 🤖 **Fits LLM and RAG pipelines**: optional Markdown output keeps formatting and link targets.
- ⚡ **Works fast**: plain HTTP requests, roughly 3,000 posts per minute.
- 🧩 **Runs on the Apify platform**: API, schedules, webhooks, and integrations with Make, n8n, Zapier, Google Sheets and Slack.

## What data can you extract from a Telegram channel?

| Field | Description |
| --- | --- |
| `channel`, `channelTitle` | Channel username and display name |
| `channelSubscribers`, `channelIsVerified` | Exact subscriber count and verified badge |
| `id`, `url`, `date` | Post number, permanent link and publication time (UTC) |
| `text`, `markdown`, `html` | Post text as plain text, and optionally as Markdown or HTML |
| `views` | View counter |
| `reactions`, `reactionsCount` | Every reaction with its counter, including paid (Stars) and custom emoji |
| `photos`, `videos`, `documents`, `voiceMessages` | Media links, video duration and thumbnail, file names and sizes |
| `poll` | Question, options with percentages and number of voters |
| `linkPreview` | Site name, title, description and image of the attached link |
| `hashtags`, `mentions`, `links`, `buttons` | Everything clickable in the post |
| `isForwarded`, `forwardedFrom`, `replyTo` | Where the post came from and what it answers |
| `isEdited`, `author`, `mediaTypes`, `isUnsupported` | Edit mark, author signature, attachment kinds, and a flag for content Telegram hides on the web |
| `matchedKeywords` | Which of your keywords were found in the post |

## How to scrape a Telegram channel

1. Open the Actor and go to the **Input** tab.
2. Add one or more channels. Any of these forms work: `telegram`, `@telegram`, `https://t.me/telegram`.
3. Set **Maximum posts per channel**.
4. Optionally set a date range or keywords.
5. Press **Start**. When the run finishes, open the **Output** tab and download the data as JSON, CSV, Excel or HTML, or read it through the API.

## How to monitor Telegram channels for new posts

1. Turn on **Only new posts since the last run**.
2. Save the input as a task and add a schedule, for example every hour.
3. The first run returns the newest posts up to your limit. Every later run returns only posts that appeared after it.
4. Connect a webhook or an integration to send new posts to Slack, Google Sheets, a database or your own service.

Runs that use the same **Monitor name** share one memory. Give each independent task its own name if several tasks track the same channel. Monitoring also works together with **Keywords**: you get only new posts that mention your words, which makes a simple brand or keyword alert.

If a channel published more new posts than **Maximum posts per channel** allows, the newest ones are returned and the older ones are skipped, so set the limit above the number of posts you expect between two runs.

## How much does it cost to scrape Telegram?

You pay for results, not for time or memory:

- **$0.50 per 1,000 posts**
- **$0.00005 per run**, the standard Apify start fee

Examples: the last 1,000 posts of a channel cost about $0.50. Checking 20 channels every hour and receiving 300 new posts a day costs about $0.15 a day. A monitoring run that finds nothing new costs $0.00005. Paid Apify plans get a lower price per post.

You can cap spending with **Maximum cost per run** in the run options. The Actor stops as soon as the cap is reached and reports it in the run summary.

## Input example

```json
{
    "channels": ["telegram", "https://t.me/durov"],
    "maxPostsPerChannel": 200,
    "postsFrom": "30 days",
    "keywords": ["update", "privacy"],
    "onlyNewPosts": false,
    "includeMarkdown": true
}
```

## Output example

One item per post. This is a real post from the official `telegram` channel:

```json
{
    "channel": "telegram",
    "channelTitle": "Telegram News",
    "channelSubscribers": 9137643,
    "channelIsVerified": true,
    "id": 458,
    "url": "https://t.me/telegram/458",
    "date": "2026-08-26T19:12:04.000Z",
    "text": "Placeholders for App Updates. If a user with an outdated app encounters a new feature, they can now instantly tap to download the latest update.\n\nAugust Features\n1 • 2 • 3 • 4 • 5 • More",
    "views": 1350000,
    "reactions": [],
    "reactionsCount": 0,
    "isEdited": false,
    "isUnsupported": false,
    "author": null,
    "isForwarded": false,
    "forwardedFrom": null,
    "replyTo": null,
    "hashtags": [],
    "mentions": [],
    "links": ["https://t.me/telegram/455", "https://t.me/telegram/456", "https://t.me/telegram/457", "https://t.me/telegram/459", "https://t.me/telegram/460"],
    "buttons": [],
    "photos": ["https://cdn1.telesco.pe/file/wAlDbStbamcH9ArFUvhJn5Ka...jpg"],
    "videos": [],
    "documents": [],
    "voiceMessages": [],
    "poll": null,
    "linkPreview": null,
    "mediaTypes": ["photo"],
    "markdown": "**Placeholders for App Updates.** If a user with an **outdated app** encounters a new feature, they can now **instantly tap** to download the latest update.\n\nAugust Features\n[1](https://t.me/telegram/455) • [2](https://t.me/telegram/456) • [3](https://t.me/telegram/457) • **4** • [5](https://t.me/telegram/459) • [More](https://t.me/telegram/460)",
    "scrapedAt": "2026-11-12T09:51:20.871Z"
}
```

When a post has reactions, a video or a poll, those fields look like this:

```json
{
    "reactions": [
        { "type": "emoji", "emoji": "👍", "customEmojiId": null, "count": 256 },
        { "type": "paid", "emoji": "⭐", "customEmojiId": null, "count": 11600 },
        { "type": "custom", "emoji": null, "customEmojiId": "5399847211989246390", "count": 17200 }
    ],
    "videos": [{ "url": "https://cdn4.telesco.pe/file/example.mp4", "thumbnailUrl": "https://cdn4.telesco.pe/file/example.jpg", "duration": "1:15", "durationSeconds": 75 }],
    "poll": {
        "question": "Do you like the new design?",
        "type": "Anonymous Poll",
        "voters": 8440,
        "options": [{ "text": "Yes", "percent": 66 }, { "text": "No", "percent": 34 }]
    }
}
```

A short report for every channel (posts saved, channels without a public preview, whether the spending cap was reached) is stored in the key-value store under the key `SUMMARY`.

## Use it from code

```bash
curl "https://api.apify.com/v2/acts/<username>~telegram-channel-scraper/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -X POST -H "Content-Type: application/json" \
  -d '{ "channels": ["telegram"], "maxPostsPerChannel": 50 }'
```

The Actor also works as a tool for AI agents through the [Apify MCP server](https://docs.apify.com/mcp).

## FAQ

### Which channels are supported?

Public channels that have a username and a web preview at `t.me/s/<channel>`. Private channels, invite links, groups, bots and user profiles are not supported, and neither are channels whose preview Telegram restricts. Such channels are listed in the run summary and are not charged.

### How does the keyword filter work?

The Actor reads the channel post by post within your date range and keeps the posts that contain at least one keyword. It looks at the text, poll, link preview and file names, ignores letter case and matches parts of words, so `update` also finds `updates`. It does not rely on Telegram's own web search, which returns only about 20 of the newest matches.

### Does it return comments?

No. Comments live in a separate discussion group and are not part of the channel preview.

### How exact are the numbers?

The subscriber count is exact. Telegram rounds view and reaction counters above 1,000 on its public pages, so `635K` is returned as `635000`.

### Can I download photos and videos?

Posts contain direct links to photos, video files and thumbnails. These are Telegram's own links and they can expire, so download the files soon after the run. Very large videos have a thumbnail and a duration but no direct file link, and files show their name and size only.

### Why is `isUnsupported` true for some posts?

Telegram does not show every kind of content on the web, for example live streams and paid media. For such posts you still get the link, date, views and reactions.

### Why did the run stop before it finished?

Every run has a time limit (**Run options → Timeout**). About 30 seconds before it, the Actor stops, keeps everything it has saved and explains the reason in the status message and in the summary. Raise the timeout and start again, or press **Resurrect** on the finished run: it continues where it stopped and does not return the same posts twice.

### Is it legal to scrape Telegram?

The Actor reads only what Telegram publishes for everyone without logging in. You are responsible for how you use the data. Posts can contain personal data, which is protected by laws such as the GDPR, so collect it only when you have a legitimate reason.

### Something does not work

Open the **Issues** tab and describe the channel and the input you used. Issues are answered there.

## Парсер Telegram-каналов

Выгружает посты из любых **публичных Telegram-каналов**: текст, дату, просмотры, реакции, фото, видео, опросы, ссылки, хэштеги и источники репостов. Не нужен аккаунт Telegram, номер телефона или API-ключ.

- Укажите каналы: `telegram`, `@telegram` или `https://t.me/telegram`.
- Задайте лимит постов, период или ключевые слова.
- Включите **Only new posts since the last run** и поставьте запуск по расписанию, чтобы получать только новые посты.
- Результат доступен в JSON, CSV, Excel и через API.

Цена: $0.50 за 1000 постов, запуск стоит $0.00005. Закрытые каналы, группы и комментарии не поддерживаются.
