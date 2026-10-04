import {useEffect, type RefObject} from 'react';
import type {TableSchema, Visualization} from '../../domain/model';
/** Charts use bounded rows; conversion to canvas doubles is checked and visible. */
function numeric(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim())
    throw Error('Die gewählte Achse benötigt numerische Werte.');
  const n = Number(value);
  if (!Number.isFinite(n))
    throw Error('NaN und unendliche Werte können nicht gezeichnet werden. Bitte in SQL filtern.');
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER)
    throw Error('Wert überschreitet die exakte Diagrammpräzision. Bitte in SQL skalieren.');
  // Reject loss of significant digits; numeric spellings with trailing zeroes are equivalent.
  const normalized = (text: string) =>
    text
      .replace(/^\+/, '')
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '')
      .replace(/^(-?)0+(?=\d)/, '$1');
  if (
    !/[eE]/.test(value) &&
    !/[eE]/.test(String(n)) &&
    normalized(value) !== normalized(String(n)) &&
    !(n === 0 && Number(value) === 0)
  )
    throw Error(
      'Dezimalwert ist für das Diagramm nicht exakt darstellbar. Bitte in SQL explizit runden.',
    );
  return n;
}
export function Chart({
  canvas,
  data,
  spec,
  title,
  onError,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  data: {schema: TableSchema; rows: unknown[][]};
  spec: Visualization['spec'];
  title: string;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1000, 480);
    try {
      const xi = data.schema.columns.findIndex((c) => c.name === spec.x),
        yi = data.schema.columns.findIndex((c) => c.name === spec.y),
        ci = data.schema.columns.findIndex((c) => c.name === spec.color);
      const xType = data.schema.columns[xi]!.logicalType;
      const numericX =
        /^(U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|DECIMAL|DOUBLE|FLOAT|REAL)/.test(xType);
      const dateX = /^(DATE|TIMESTAMP)/.test(xType);
      const axisX = (value: unknown, index: number) => {
        if (spec.type === 'bar') return index;
        if (value === null) return null;
        if (numericX || spec.type === 'scatter') return numeric(value);
        if (dateX) {
          const text = String(value);
          const instant = Date.parse(
            text.length === 10
              ? text + 'T00:00:00Z'
              : text.replace(' ', 'T') + (/(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(text) ? '' : 'Z'),
          );
          if (!Number.isFinite(instant))
            throw Error('Datum kann nicht auf der Achse dargestellt werden.');
          return instant;
        }
        return index;
      };
      const points = data.rows.map((row, i) => ({
        x: axisX(row[xi], i),
        y: numeric(row[yi]),
        label: row[xi] === null ? 'NULL' : String(row[xi]),
        category: ci < 0 ? '' : String(row[ci]),
      }));
      const finite = points.filter(
        (p): p is typeof p & {x: number; y: number} => p.y !== null && p.x !== null,
      );
      const ys = finite.map((p) => p.y),
        xs = finite.map((p) => p.x);
      const minY = Math.min(0, ...ys),
        maxY = Math.max(0, ...ys),
        minX = xs.length ? Math.min(...xs) : 0,
        maxX = xs.length ? Math.max(...xs) : 1;
      const x = (v: number) => 70 + ((v - minX) / (maxX - minX || 1)) * 870;
      const y = (v: number) => 410 - ((v - minY) / (maxY - minY || 1)) * 340;
      ctx.strokeStyle = '#81909b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(70, 70);
      ctx.lineTo(70, 410);
      ctx.lineTo(955, 410);
      ctx.stroke();
      ctx.fillStyle = '#243746';
      ctx.font = '18px sans-serif';
      ctx.fillText(title, 70, 28);
      ctx.font = '12px sans-serif';
      ctx.fillText(spec.y, 10, 52);
      ctx.fillText(spec.x, 850, 466);
      ctx.fillText(String(maxY), 5, 78);
      ctx.fillText(String(minY), 5, 412);
      const cats = [...new Set(points.map((p) => p.category))];
      const color = (cat: string) => `hsl(${cats.indexOf(cat) * 137.5 + 205} 55% 40%)`;
      if (spec.type === 'line') {
        for (const cat of cats) {
          ctx.strokeStyle = color(cat);
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          for (const p of points) {
            if (p.category !== cat) continue;
            if (p.x === null || p.y === null) {
              started = false;
              continue;
            }
            if (started) ctx.lineTo(x(p.x), y(p.y));
            else ctx.moveTo(x(p.x), y(p.y));
            started = true;
          }
          ctx.stroke();
        }
      }
      for (const p of finite) {
        ctx.fillStyle = color(p.category);
        if (spec.type === 'bar') {
          const width = Math.min(35, 780 / points.length);
          ctx.fillRect(x(p.x) - width / 2, Math.min(y(p.y), y(0)), width, Math.abs(y(p.y) - y(0)));
        } else {
          ctx.beginPath();
          ctx.arc(x(p.x), y(p.y), spec.type === 'scatter' ? 3 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const step = Math.max(1, Math.ceil(points.length / 8));
      ctx.fillStyle = '#243746';
      points.forEach((p, i) => {
        if (i % step === 0 && p.x !== null) ctx.fillText(p.label.slice(0, 20), x(p.x) - 15, 435);
      });
      if (ci >= 0) {
        ctx.font = '11px sans-serif';
        cats.forEach((cat, i) => {
          ctx.fillStyle = color(cat);
          ctx.fillText(cat.slice(0, 24), 70 + (i % 8) * 110, 48 + Math.floor(i / 8) * 12);
        });
      }
      onError('');
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [canvas, data, spec, title, onError]);
  return (
    <canvas
      ref={canvas}
      width={1000}
      height={480}
      role="img"
      aria-label={`${title}: ${spec.type}, X ${spec.x}, Y ${spec.y}. NULL-Werte werden ausgelassen.`}
    />
  );
}
