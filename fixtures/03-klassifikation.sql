SELECT klasse, COUNT(*) AS anzahl
FROM data.vergleich
GROUP BY klasse
ORDER BY klasse;
