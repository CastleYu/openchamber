import config from '../../personal-build.json' with { type: 'json' };

export const PERSONAL_BUILD = Object.freeze({
  ...config,
  notifyOnly: config.updatePolicy === 'notify-only',
  disabledMessage: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
  releaseUrl: 'https://github.com/openchamber/openchamber/releases',
  releaseApi: 'https://api.github.com/repos/openchamber/openchamber/releases/latest',
});

export function personalVersion(upstream, build = '') {
  if (!/^\d+\.\d+\.\d+$/.test(upstream) || !/^[1-9]\d*$/.test(config.featureVersion)) {
    throw new Error('Upstream versions must use major.minor.patch; DIJIANG revisions must be positive integers.');
  }
  if (build && !/^[1-9]\d*\.[1-9]\d*$/.test(build)) {
    throw new Error('CI build must use run_number.run_attempt.');
  }
  return `${upstream}-DIJIANG.${config.featureVersion}`;
}

export function assertUpdatesAllowed() {
  if (PERSONAL_BUILD.notifyOnly) throw new Error(PERSONAL_BUILD.disabledMessage);
}
