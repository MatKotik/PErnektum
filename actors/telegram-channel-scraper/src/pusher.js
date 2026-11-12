/**
 * Delivers posts to the dataset one batch at a time and never exceeds the user's spending limit.
 */

/**
 * @param {object} options
 * @param {() => number} options.remainingBudget   how many more results may be charged (Infinity when unlimited)
 * @param {(posts: object[]) => Promise<unknown>} options.pushData
 */
export function createPusher({ remainingBudget, pushData }) {
    let queue = Promise.resolve();
    let exhausted = false;
    let total = 0;

    return {
        /**
         * Queues a batch. Resolves with the number of posts that were actually stored.
         *
         * @param {object[]} posts
         * @returns {Promise<number>}
         */
        push(posts) {
            const task = queue.then(async () => {
                const allowed = Math.min(posts.length, Math.max(0, remainingBudget()));
                if (allowed < posts.length) exhausted = true;
                if (allowed === 0) return 0;
                await pushData(posts.slice(0, allowed));
                total += allowed;
                return allowed;
            });
            queue = task.catch(() => {});
            return task;
        },
        /** Resolves when every queued batch has been handled. */
        idle: () => queue,
        /** True once a batch had to be cut because of the spending limit. */
        get exhausted() { return exhausted; },
        /** Posts stored so far. */
        get total() { return total; },
    };
}
