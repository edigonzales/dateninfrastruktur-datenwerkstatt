export async function downloadStream(
  stream: ReadableStream<Uint8Array>,
  name: string,
  mediaType: string,
) {
  const blob = await new Response(stream, {headers: {'Content-Type': mediaType}}).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  link.click();
  // Give the browser download manager time to consume the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
