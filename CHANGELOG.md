# Pakeitimų istorija

Versijos numeruojamos pagal [SemVer](https://semver.org/lang/lt/): `DIDELĖ.MAŽA.PATAISA`.
Žaidėjai su skirtingomis versijomis kartu žaisti negali – žaidimas paprašys perkrauti puslapį.

## 1.5.0 – 2026-11-22
- Pridėti nemokami TURN serveriai be registracijos: freeturn.net ir Elixir WebRTC Rel (laikini prisijungimo duomenys).
- Diagnostikoje TURN serveriai rodomi pagal pavadinimą.

## 1.4.0 – 2026-11-22
- Ryšio diagnostika: tikrina vietinį ir viešą adresą, kiekvieną TURN serverį, rodo paskutinius ryšio įvykius; ataskaitą galima nukopijuoti.
- Galima prijungti savo TURN serverį (Metered API raktas arba statiniai serveriai) faile `turn.js`.
- Ryšio įvykių žurnalas (ICE būsenos, per kokį kanalą užmegztas ryšys).

## 1.3.0 – 2026-11-22
- Žaidimo versija rodoma viršuje kairėje ir pradžios ekrane.
- Prisijungiant tikrinama, ar žaidėjo ir šeimininko versijos sutampa.
- Diegimo metu failams pridedamas versijos parametras, kad telefonai nekrautų senų failų iš talpyklos.

## 1.2.0 – 2026-11-22
- Pervadinta: „Durnius“, „Mušta“.
- „WiFi režimas“ žaidėjams tame pačiame WiFi tinkle, atsarginiai TURN serveriai.
- Aiškesnis pranešimas, kai nepavyksta prisijungti.

## 1.1.1 – 2026-11-22
- Garso mygtukas perkeltas į viršutinę juostą.

## 1.1.0 – 2026-11-22
- Animacijos, ėjimo įspėjimai (užrašas, švytėjimas, garsas, vibracija), konfeti, nauja išvaizda.

## 1.0.0 – 2026-11-22
- Pirmoji versija: Durnius 2–6 žaidėjams per WebRTC, prisijungimas QR kodu, GitHub Pages.
