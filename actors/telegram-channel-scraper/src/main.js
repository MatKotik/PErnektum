/**
 * Telegram Channel Scraper & Monitor — Apify Actor entry point.
 *
 * Reads the input, scrapes each channel through Telegram's public web preview,
 * stores posts in the default dataset and, in monitoring mode, remembers the last
 * delivered post per channel so the next run returns only new ones.
 */
import { Actor, log } from 'apify';

import { readInput, stateKey } from './input.js';
import { createPusher } from './pusher.js';
import { scrapeChannel } from './scraper.js';
import { ChannelUnavailableError, RateLimiter } from './telegram.js';
import { InputError, runWithConcurrency } from './utils.js';

const DATASET_ITEM_EVENT = 'apify-default-dataset-item';
const MONITOR_STORE_NAME = 'telegram-channel-scraper-monitor';
const CHANNEL_CONCURRENCY = 4;
const REQUESTS_PER_SECOND = 5;
const STATUS_UPDATE_INTERVAL_MS = 5_000;

async function main() {
    const settings = readInput((await Actor.getInput()) ?? {});
    const { channels, rejected, onlyNewPosts } = settings;
    for (const item of rejected) log.warning(`Skipping "${item.input}": ${item.reason}`);

    // How many more results the user's spending limit allows. Infinity when there is no limit.
    const charging = Actor.getChargingManager();
    const remainingBudget = () => {
        try {
            return charging.calculateMaxEventChargeCountWithinLimit(DATASET_ITEM_EVENT);
        } catch {
            return Infinity;
        }
    };

    // Survives restarts and migrations of the run, so that nothing is delivered (and charged) twice.
    const progress = await Actor.useState('PROGRESS', { channels: {} });

    // Monitoring memory lives in a named store that outlives a single run.
    const monitorStore = onlyNewPosts ? await Actor.openKeyValueStore(MONITOR_STORE_NAME) : null;
    const monitorRecordKey = `monitor-${settings.monitorId}`;
    const monitorState = (await monitorStore?.getValue(monitorRecordKey)) ?? { channels: {} };
    let monitorDirty = false;
    const saveMonitorState = async () => {
        if (!monitorStore || !monitorDirty) return;
        monitorDirty = false;
        await monitorStore.setValue(monitorRecordKey, monitorState);
    };
    Actor.on('persistState', saveMonitorState);
    Actor.on('migrating', saveMonitorState);
    Actor.on('aborting', saveMonitorState);

    // Pushing is serialized so the spending limit is applied to posts in a predictable order.
    const pusher = createPusher({ remainingBudget, pushData: (posts) => Actor.pushData(posts) });

    const rateLimiter = new RateLimiter(REQUESTS_PER_SECOND);
    const summary = [];
    let finished = 0;
    let lastStatusAt = 0;

    await runWithConcurrency(channels, CHANNEL_CONCURRENCY, async ({ input, username }) => {
        const key = stateKey(username);
        const saved = progress.channels[key];
        if (saved?.done) {
            summary.push(saved.summary);
            finished++;
            return;
        }
        if (pusher.exhausted) {
            summary.push({ input, channel: username, status: 'skipped', posts: 0, note: 'Spending limit reached before this channel was processed.' });
            finished++;
            return;
        }

        const lastSeenId = onlyNewPosts ? (monitorState.channels[key]?.lastPostId ?? null) : null;
        let entry;
        try {
            const result = await scrapeChannel({
                channel: username,
                keywords: settings.keywords,
                maxPosts: settings.maxPosts,
                fromDate: settings.fromDate,
                toDate: settings.toDate,
                lastSeenId,
                resume: saved ? { cursor: saved.cursor, pushed: saved.pushed, newestSeenId: saved.newestSeenId } : null,
                includeMarkdown: settings.includeMarkdown,
                includeHtml: settings.includeHtml,
                includeChannelDetails: settings.includeChannelDetails,
                pushPosts: pusher.push,
                onProgress: (state) => { progress.channels[key] = { ...state, done: false }; },
                rateLimiter,
                log,
            });

            entry = {
                input,
                channel: result.channel,
                status: 'ok',
                posts: result.pushed,
                stopReason: result.stopReason,
                newestPostId: result.newestSeenId,
                subscribers: result.subscribers,
            };

            // Remember where we stopped, unless the spending limit cut the channel off before anything was delivered.
            const nothingDelivered = result.stopReason === 'budget' && result.pushed === 0;
            if (onlyNewPosts && result.newestSeenId != null && !nothingDelivered) {
                monitorState.channels[key] = { lastPostId: Math.max(result.newestSeenId, lastSeenId ?? 0), updatedAt: new Date().toISOString() };
                monitorDirty = true;
            }
            if (result.stopReason === 'budget') {
                log.warning(`Spending limit reached while reading "${result.channel}". Raise the maximum cost per run to get the remaining posts.`);
            }
        } catch (error) {
            // Whatever was stored before the error stays in the dataset, so it is reported and remembered.
            const partial = progress.channels[key];
            const delivered = partial?.pushed ?? 0;
            if (error instanceof ChannelUnavailableError) {
                entry = { input, channel: username, status: 'unavailable', posts: delivered, note: error.message };
                log.warning(error.message);
            } else {
                entry = { input, channel: username, status: 'failed', posts: delivered, note: error.message };
                log.error(`Channel "${username}" failed: ${error.message}`);
            }
            if (onlyNewPosts && delivered > 0 && partial?.newestSeenId != null) {
                monitorState.channels[key] = { lastPostId: Math.max(partial.newestSeenId, lastSeenId ?? 0), updatedAt: new Date().toISOString() };
                monitorDirty = true;
            }
        }

        summary.push(entry);
        progress.channels[key] = { ...(progress.channels[key] ?? {}), done: true, summary: entry };
        finished++;
        if (entry.status === 'ok') {
            log.info(`${entry.channel}: ${entry.posts} post(s)${onlyNewPosts && lastSeenId != null ? ' new since the last run' : ''}.`);
        }
        if (Date.now() - lastStatusAt >= STATUS_UPDATE_INTERVAL_MS) {
            lastStatusAt = Date.now();
            await Actor.setStatusMessage(`Channels: ${finished}/${channels.length}, posts saved: ${pusher.total}`).catch(() => {});
        }
    });

    await pusher.idle();
    await saveMonitorState();

    const count = (status) => summary.filter((item) => item.status === status).length;
    // Counted from the per-channel report, so a run that was restarted midway still reports everything it stored.
    const totalPosts = summary.reduce((sum, item) => sum + (item.posts ?? 0), 0);
    const totals = {
        channels: channels.length,
        ok: count('ok'),
        unavailable: count('unavailable'),
        failed: count('failed'),
        skipped: count('skipped'),
        rejectedInputs: rejected.length,
        posts: totalPosts,
        spendingLimitReached: pusher.exhausted,
    };
    await Actor.setValue('SUMMARY', { totals, channels: summary, rejectedInputs: rejected });

    const parts = [`Saved ${totalPosts} post(s) from ${totals.ok} channel(s).`];
    if (totals.unavailable) parts.push(`${totals.unavailable} channel(s) have no public preview.`);
    if (totals.failed) parts.push(`${totals.failed} channel(s) failed.`);
    if (pusher.exhausted) parts.push('Stopped early: the maximum cost per run was reached.');
    const message = parts.join(' ');

    // Fail only when nothing worked for a technical reason, so the user knows a retry makes sense.
    if (totals.ok === 0 && totals.failed > 0) {
        await Actor.fail(`${message} See the log for details.`);
        return;
    }
    await Actor.exit(message);
}

await Actor.init();
try {
    await main();
} catch (error) {
    if (error instanceof InputError) {
        await Actor.fail(`Invalid input. ${error.message}`);
    } else {
        log.exception(error, 'The run stopped because of an unexpected error.');
        await Actor.fail(`Unexpected error: ${error.message}`);
    }
}
