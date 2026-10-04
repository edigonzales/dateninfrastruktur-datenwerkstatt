import {AppFailure} from '../../application/errors';
/** Check network/MIME before allocating a worker; no HTML fallback can masquerade as a binary. */
export async function checkRuntimeAsset(
  url: string,
  kind: 'wasm' | 'javascript',
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    method: 'HEAD',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    cache: 'no-cache',
  });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (
    !response.ok ||
    (kind === 'wasm'
      ? type !== 'application/wasm'
      : !['application/javascript', 'text/javascript'].includes(type ?? ''))
  )
    throw new AppFailure(
      'SOURCE_UNAVAILABLE',
      `Runtimeasset ${new URL(url, location.href).pathname}: HTTP ${response.status}, MIME ${type ?? 'fehlt'}. Auslieferung korrigieren und erneut versuchen.`,
      true,
    );
}
