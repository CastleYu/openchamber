import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import util from 'util';

const LOG_DIR_NAME = 'logs';
const LOG_FILE_PREFIX = 'openchamber-';
const LOG_FILE_SUFFIX = '.log';
const DEFAULT_KEEP_DAYS = 7;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_LOG_NAME_LENGTH = 128;

const SENSITIVE_KEY_SOURCE = '(?:password|passwd|secret|token|authorization|api[_-]?key|access[_-]?key|credential|client[_-]?secret)';
// The closing quote is a backreference to the opening one and must be its own
// capture group, or it silently disappears from the replacement.
const REDACT_KV_PATTERN = new RegExp(
  `(["']?)([\\w.\\-]*${SENSITIVE_KEY_SOURCE}[\\w.\\-]*)(\\1)(\\s*[:=]\\s*)(?!\\s*["']?bearer\\b)("[^"\\n]*"|'[^'\\n]*'|[^\\s,&;]+)`,
  'gi'
);
const REDACT_BEARER_PATTERN = /(bearer\s+)[^\s"',}]+/gi;

/**
 * Masks secret-looking values in free text (key=value pairs, JSON fragments,
 * Authorization headers) so teed console output never persists credentials.
 */
export const redactText = (text) => {
  let output = String(text);
  output = output.replace(REDACT_BEARER_PATTERN, '$1***');
  output = output.replace(REDACT_KV_PATTERN, '$1$2$3$4"***"');
  return output;
};

const isSensitiveKey = (key) => new RegExp(`^([\\w.\\-]*${SENSITIVE_KEY_SOURCE}[\\w.\\-]*)$`, 'i').test(String(key));

const redactValue = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? '***' : redactValue(item, depth + 1);
  }
  return output;
};

const isValidLogFileName = (name) => (
  typeof name === 'string'
  && name.length <= MAX_LOG_NAME_LENGTH
  && name.startsWith(LOG_FILE_PREFIX)
  && name.endsWith(LOG_FILE_SUFFIX)
  && /^openchamber-[\w.-]+\.log$/.test(name)
);

export const createRuntimeLog = ({
  dataDir,
  now = () => new Date(),
  keepDays = DEFAULT_KEEP_DAYS,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  onError = () => {},
}) => {
  const logsDir = path.join(dataDir, LOG_DIR_NAME);
  let currentFileName = null;
  let currentBytes = 0;
  let cleanedDateKey = null;

  const dateKeyOf = (date) => date.toISOString().slice(0, 10);

  const cleanupOldFiles = async (dateKey) => {
    if (cleanedDateKey === dateKey) return;
    cleanedDateKey = dateKey;
    try {
      const names = await fsp.readdir(logsDir);
      const cutoffMs = now().getTime() - keepDays * 24 * 60 * 60 * 1000;
      await Promise.all(names.map(async (name) => {
        const match = /^openchamber-(\d{4}-\d{2}-\d{2})/.exec(name);
        if (!match) return;
        const fileDate = new Date(`${match[1]}T00:00:00.000Z`);
        if (Number.isNaN(fileDate.getTime())) return;
        if (fileDate.getTime() >= cutoffMs) return;
        await fsp.rm(path.join(logsDir, name), { force: true }).catch(() => {});
      }));
    } catch {
      // The logs directory may not exist yet; nothing to clean.
    }
  };

  const resolveTargetFile = async (dateKey) => {
    if (currentFileName && currentBytes < maxFileBytes) {
      return path.join(logsDir, currentFileName);
    }
    await fsp.mkdir(logsDir, { recursive: true });
    let fileName = `${LOG_FILE_PREFIX}${dateKey}${LOG_FILE_SUFFIX}`;
    if (currentBytes >= maxFileBytes) {
      let suffix = 1;
      for (;;) {
        const candidate = `${LOG_FILE_PREFIX}${dateKey}.${suffix}${LOG_FILE_SUFFIX}`;
        try {
          await fsp.access(path.join(logsDir, candidate));
          suffix += 1;
        } catch {
          fileName = candidate;
          break;
        }
      }
    }
    currentFileName = fileName;
    currentBytes = 0;
    return path.join(logsDir, fileName);
  };

  const appendSerialized = async (dateKey, line) => {
    await cleanupOldFiles(dateKey);
    const targetFile = await resolveTargetFile(dateKey);
    await fsp.appendFile(targetFile, `${line}\n`, 'utf8');
    currentBytes += Buffer.byteLength(line, 'utf8') + 1;
  };

  const append = (level, args) => {
    const date = now();
    const dateKey = dateKeyOf(date);
    const entry = {
      ts: date.toISOString(),
      level,
      msg: redactText(util.format(...args)),
    };
    return appendSerialized(dateKey, JSON.stringify(entry)).catch((error) => {
      onError(error);
    });
  };

  const appendEntry = (entry) => {
    const date = now();
    const dateKey = dateKeyOf(date);
    const payload = redactValue(entry);
    const serialized = JSON.stringify({ ts: date.toISOString(), level: 'info', ...payload });
    return appendSerialized(dateKey, serialized).catch((error) => {
      onError(error);
    });
  };

  const getInfo = async () => {
    await fsp.mkdir(logsDir, { recursive: true }).catch(() => {});
    const names = (await fsp.readdir(logsDir).catch(() => []))
      .filter(isValidLogFileName)
      .sort();
    const files = await Promise.all(names.map(async (name) => {
      const stats = await fsp.stat(path.join(logsDir, name)).catch(() => null);
      return {
        name,
        size: stats?.size ?? 0,
        modifiedAt: stats?.mtimeMs ?? 0,
      };
    }));
    return {
      directory: logsDir,
      current: currentFileName,
      files,
    };
  };

  const readLogFileName = async (name) => {
    if (!isValidLogFileName(name)) {
      throw new Error('Invalid log file name');
    }
    return fsp.readFile(path.join(logsDir, name), 'utf8');
  };

  return {
    logsDir,
    append,
    appendEntry,
    getInfo,
    readLogFileName,
  };
};

/**
 * Routes console output into the JSONL log file while preserving stdout.
 * The tee is best-effort: logging failures go to raw stderr, never back
 * through the (already replaced) console.
 */
export const installConsoleTee = ({ runtimeLog, logger = console }) => {
  const original = {
    log: logger.log.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
  };
  const writeStderr = process.stderr.write.bind(process.stderr);

  const reportAppendError = (error) => {
    writeStderr(`[runtime-log] append failed: ${error?.message ?? error}\n`);
  };

  const makeTee = (level, originalFn) => (...args) => {
    try {
      originalFn(...args);
    } catch {
      // stdout must never break the caller.
    }
    runtimeLog.append(level, args).catch((error) => reportAppendError(error));
  };

  logger.log = makeTee('info', original.log);
  logger.info = makeTee('info', original.info);
  logger.warn = makeTee('warn', original.warn);
  logger.error = makeTee('error', original.error);

  return {
    restore: () => {
      logger.log = original.log;
      logger.info = original.info;
      logger.warn = original.warn;
      logger.error = original.error;
    },
  };
};
