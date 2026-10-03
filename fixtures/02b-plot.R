# Optionale Grafikprüfung; vorher 02-vergleich.R ausführen.
plot_daten <- vergleich[!is.na(vergleich$fahrzeuge_pro_1000), ]
barplot(
  plot_daten$fahrzeuge_pro_1000,
  names.arg = plot_daten$gemeinde,
  horiz = TRUE,
  xlab = "Fahrzeuge pro 1'000 Einwohner",
  main = "Synthetische Testdaten"
)
