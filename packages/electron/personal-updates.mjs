import { PERSONAL_BUILD } from '../web/server/lib/personal-build.js';
import { z } from 'zod';

const Release = z.object({
  tag_name: z.string().regex(/^v?\d+\.\d+\.\d+$/),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
});

export async function checkPersonalUpdate({ currentVersion, upstreamVersion, compareVersions, request = fetch }) {
  const response = await request(PERSONAL_BUILD.releaseApi, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
  const release = Release.parse(await response.json());
  const version = release.tag_name.replace(/^v/, '');
  return {
    available: compareVersions(version, upstreamVersion) > 0,
    currentVersion,
    version,
    notifyOnly: true,
    releaseUrl: `${PERSONAL_BUILD.releaseUrl}/tag/v${version}`,
    body: release.body ?? undefined,
    date: release.published_at ?? undefined,
  };
}
