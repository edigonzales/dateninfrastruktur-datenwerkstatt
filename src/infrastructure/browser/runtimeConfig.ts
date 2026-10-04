import {z} from 'zod';
import type {RuntimeConfig} from '../../../contracts/runtime-config';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const schema = z
  .strictObject({
    formatVersion: z.literal(1),
    appBasePath: z
      .string()
      .regex(/^\/([^?#\\]*\/)?$/)
      .refine((s) => !s.split('/').includes('..')),
    buildId: z.string().min(1),
    portalProviders: z.array(
      z.strictObject({
        id: z.string().min(1),
        title: z.string().min(1),
        baseUrl: z.url(),
        indexUrl: z.url().optional(),
      }),
    ),
    allowedDataOrigins: z.array(z.url()),
    runtimes: z.strictObject({
      webRBaseUrl: z.string().min(1),
      webRPackageRepoUrl: z.string().min(1),
      webRChannel: z.enum(['post-message', 'auto']),
      packageLockUrl: z.string().min(1),
    }),
    limits: z.strictObject({
      importFileBytes: positive,
      resultRows: positive,
      resultBytes: positive,
      sqlTimeoutMs: positive,
      rTimeoutMs: positive,
      cancelGraceMs: positive,
      rWarningRows: positive,
      rHardRows: positive,
      transferBytes: positive,
      archiveCompressedBytes: positive,
      archiveExpandedBytes: positive,
      archiveEntryBytes: positive,
      archiveEntries: positive,
    }),
  })
  .refine(
    (c) => c.limits.rWarningRows <= c.limits.rHardRows,
    'Warnlimit muss kleiner als Hardlimit sein.',
  );
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(`${import.meta.env.BASE_URL}runtime-config.json`, {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw Error(`runtime-config.json: HTTP ${response.status}`);
  const parsed = schema.parse(await response.json());
  if (parsed.appBasePath !== import.meta.env.BASE_URL)
    throw Error('appBasePath stimmt nicht mit dem gebauten Basispfad überein.');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  for (const value of [
    ...parsed.allowedDataOrigins,
    ...parsed.portalProviders.flatMap((p) => [p.baseUrl, ...(p.indexUrl ? [p.indexUrl] : [])]),
  ]) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          local &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        ))
    )
      throw Error('Unsichere Portal-/Daten-URL in Betreiberkonfiguration.');
  }
  for (const value of [
    parsed.runtimes.webRBaseUrl,
    parsed.runtimes.webRPackageRepoUrl,
    parsed.runtimes.packageLockUrl,
  ]) {
    const url = new URL(value, location.origin + parsed.appBasePath);
    if (url.origin !== location.origin || url.username || url.password || url.search || url.hash)
      throw Error('Runtimeassets müssen in diesem Profil lokal gehostet sein.');
  }
  return {
    ...parsed,
    runtimes: {
      ...parsed.runtimes,
      webRBaseUrl: new URL(parsed.runtimes.webRBaseUrl, location.origin + parsed.appBasePath).href,
      webRPackageRepoUrl: new URL(
        parsed.runtimes.webRPackageRepoUrl,
        location.origin + parsed.appBasePath,
      ).href,
      packageLockUrl: new URL(parsed.runtimes.packageLockUrl, location.origin + parsed.appBasePath)
        .href,
    },
    portalProviders: parsed.portalProviders.map(({indexUrl, ...provider}) => ({
      ...provider,
      ...(indexUrl ? {indexUrl} : {}),
    })),
  };
}
