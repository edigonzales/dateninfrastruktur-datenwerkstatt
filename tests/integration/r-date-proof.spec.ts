import {test, expect} from '../persistentBrowser';
test('P5 runtime gzip files stay opaque and native R Date parser works', async ({page}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    const response = await fetch('/vendor/webr/0.6.0/vfs/usr/lib/R/share.data.gz');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const url = '/vendor/webr/0.6.0/webr.js';
    const m = (await import(url)) as typeof import('webr');
    const r = new m.WebR({
      baseUrl: '/vendor/webr/0.6.0/',
      channelType: m.ChannelType.PostMessage,
      interactive: false,
    });
    try {
      await r.init();
      return {
        encoding: response.headers.get('Content-Encoding'),
        magic: [...bytes.slice(0, 2)],
        date: await r.evalRString('as.character(as.Date("2026-03-29",format="%Y-%m-%d"))'),
        next: await r.evalRNumber('1+2'),
      };
    } finally {
      r.close();
    }
  });
  expect(proof.encoding).toBeNull();
  expect(proof.magic).toEqual([31, 139]);
  expect(proof.date).toBe('2026-03-29');
  expect(proof.next).toBe(3);
});
