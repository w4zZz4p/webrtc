# 🃏 Durnius

Kortų žaidimas „Durnius“ (Durak) 2–6 žaidėjams naršyklėje. Puslapis talpinamas GitHub Pages, o žaidėjai susijungia per mažą **WebSocket** serverį Cloudflare (Worker + Durable Objects, nemokamas planas).

## Kaip žaisti
1. Atidaryk puslapį, įvesk vardą ir spausk **Sukurti kambarį**.
2. Kiti žaidėjai nuskenuoja **QR kodą** (arba atidaro nuorodą) ir spaudžia **Prisijungti**.
3. Kai visi prisijungę – **Pradėti žaidimą**.

Kambario šeimininko naršyklė laiko žaidimo būseną – jos neuždaryk partijos metu.

## Taisyklės (podkidnoj)
- 36 kortos (6–A), po 6 kortas, apatinė malkos korta – koziris. Pradeda turintis mažiausią kozirį.
- Besiginantis muša aukštesne tos pačios spalvos korta arba koziriu; kiti primeta tokio pat rango kortų (iki 6, ne daugiau nei turi besiginantis).
- Nesumušė – ima visas kortas ir praleidžia ėjimą. Sumušė – „mušta“, ir pats puola.
- Paskutinis likęs su kortomis – **durnius**.

## Techniškai
- `game.js` – žaidimo logika (veikia kambario kūrėjo naršyklėje), `app.js` – ekranas ir ryšys, `vendor/qrcode.js` – qrcode-generator 1.4.4 (MIT).
- `server/` – Cloudflare Worker, kuris tik persiunčia žinutes kambario viduje. Įkėlimo instrukcija: [server/README.md](server/README.md).
- `config.js` – serverio adresas. Testavimui galima nurodyti nuorodoje: `?server=http://127.0.0.1:8787`.
- Nutrūkus ryšiui, žaidėjai ir kambario kūrėjas prisijungia iš naujo automatiškai; partija tęsiasi.

## Versijos
- Versija nurodyta `version.js` (SemVer), pakeitimai aprašomi `CHANGELOG.md`.
- Diegimo metu prie versijos automatiškai pridedamas commit'o kodas ir data, o failams – `?v=` parametras, kad naršyklės nekrautų senų failų.
- Versija rodoma viršuje kairėje ir pradžios ekrano apačioje. Skirtingų versijų žaidėjai prisijungti negali – žaidimas paprašo perkrauti puslapį.
