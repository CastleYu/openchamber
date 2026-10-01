const STREAM_LEX_REUSE_KEY = 'openchamber_stream_lex_reuse';
const STREAM_HIGHLIGHT_KEY = 'openchamber_stream_highlight';
const cache = new Map<string, string | null>();

const read = (key: string): string | null => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let value: string | null;
    try {
        value = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
        value = null;
    }
    cache.set(key, value);
    return value;
};

export const streamTuning = {
    reuseLiveSplit: (): boolean => read(STREAM_LEX_REUSE_KEY) !== '0',
    incrementalHighlight: (): boolean => read(STREAM_HIGHLIGHT_KEY) !== 'full',
};
