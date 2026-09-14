import config from '../../personal-build.json' with { type: 'json' };

const DIJIANG_REVISION = /^[1-9]\d*\.(?:0|[1-9]\d*)$/;
// Read previously installed single-level identities without rewriting them.
const DIJIANG_IDENTITY = /^(\d+\.\d+\.\d+)(?:-DIJIANG\.[1-9]\d*(?:\.(?:0|[1-9]\d*))?(?:-DEBUG)?)?$/;

export const PERSONAL_BUILD = Object.freeze({
  ...config,
  notifyOnly: config.updatePolicy === 'notify-only',
  disabledMessage: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
  releaseUrl: 'https://github.com/openchamber/openchamber/releases',
  releaseApi: 'https://api.github.com/repos/openchamber/openchamber/releases/latest',
});

export function personalVersion(upstream, build = '') {
  if (!/^\d+\.\d+\.\d+$/.test(upstream) || !DIJIANG_REVISION.test(config.featureVersion)) {
    throw new Error('Upstream versions must use major.minor.patch; DIJIANG revisions must use feature.fix, starting at 1.0.');
  }
  if (build && !/^[1-9]\d*\.[1-9]\d*$/.test(build)) {
    throw new Error('CI build must use run_number.run_attempt.');
  }
  return `${upstream}-DIJIANG.${config.featureVersion}`;
}

export function assertUpdatesAllowed() {
  if (PERSONAL_BUILD.notifyOnly) throw new Error(PERSONAL_BUILD.disabledMessage);
}

export function personalIdentity(version) {
  const match = DIJIANG_IDENTITY.exec(version);
  if (!match) throw new Error('Invalid DIJIANG build identity.');
  return { upstream: match[1], version: version === match[1] ? personalVersion(version) : version };
}
