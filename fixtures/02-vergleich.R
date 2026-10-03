# Ausschliesslich synthetische Abnahmefixtures, keine echten Gemeindedaten.
stopifnot(is.data.frame(daten), nrow(daten) == 4L)
vergleich <- daten
vergleich$klasse <- ifelse(
  is.na(vergleich$fahrzeuge_pro_1000),
  "nicht berechenbar",
  ifelse(vergleich$fahrzeuge_pro_1000 >= 600, "hoch", "niedrig")
)
vergleich
