SELECT
  g.gemeinde_id,
  g.gemeinde,
  b.jahr,
  b.bevoelkerung,
  f.fahrzeuge,
  ROUND(1000.0 * f.fahrzeuge / NULLIF(b.bevoelkerung, 0), 1)
    AS fahrzeuge_pro_1000
FROM data.bevoelkerung AS b
JOIN data.fahrzeuge AS f
  ON b.gemeinde_id = f.gemeinde_id AND b.jahr = f.jahr
JOIN data.gemeinden AS g
  ON g.gemeinde_id = b.gemeinde_id
WHERE b.jahr = $jahr
ORDER BY fahrzeuge_pro_1000 DESC NULLS LAST, g.gemeinde_id;
