# 🃏 Durnius

Kortų žaidimas „Durnius“ (Durak) 2–6 žaidėjams naršyklėje. Žaidėjai jungiasi tiesiogiai per **WebRTC** (PeerJS), serverio nereikia – tik statinis puslapis GitHub Pages.

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
- `game.js` – žaidimo logika, `app.js` – UI ir tinklas, `vendor/` – PeerJS 1.5.4 ir qrcode-generator 1.4.4 (MIT).
- **Tas pats WiFi:** naršyklės slepia vietinius IP adresus, o daugelis maršrutizatorių neleidžia telefonams susijungti per išorinį adresą. Mygtukas „WiFi režimas“ paprašo mikrofono leidimo (srautas iškart sustabdomas) – tada naršyklė atskleidžia vietinį IP ir ryšys užmezgamas tiesiogiai. Taip pat pridėti atsarginiai TURN serveriai.
- Signalizacijai naudojamas nemokamas PeerJS debesies serveris; ryšys tarp žaidėjų – tiesioginis WebRTC (STUN). Kai kuriuose griežtuose tinkluose (pvz. mobilusis internetas su simetriniu NAT) ryšys gali nepavykti.
- Lokaliam testavimui: `?peerhost=127.0.0.1&peerport=9000` su savo `peerjs` serveriu.
