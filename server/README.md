# Durnius žaidimo serveris (Cloudflare Worker)

Mažas serveris, kuris persiunčia žinutes tarp kambario kūrėjo ir žaidėjų per WebSocket.
Žaidimo logika lieka kambario kūrėjo naršyklėje. Kiekvienas kambarys yra atskiras Durable Object.

## Įkėlimas per GitHub (be kompiuterio)

1. Susikurk nemokamą paskyrą https://dash.cloudflare.com/sign-up ir vieną kartą atidaryk **Workers & Pages**:
   Cloudflare paprašys pasirinkti `*.workers.dev` subdomeną (pvz. `jonas`).
2. **Account ID**: Workers & Pages puslapio dešinėje (arba bet kurio domeno apžvalgoje) – nukopijuok.
3. **API token**: My Profile → API Tokens → Create Token → šablonas **Edit Cloudflare Workers** → Continue → Create. Nukopijuok žetoną (rodomas tik vieną kartą).
4. GitHub repozitorijoje: **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_ACCOUNT_ID` – Account ID
   - `CLOUDFLARE_API_TOKEN` – API žetonas
5. **Actions → Deploy game server to Cloudflare → Run workflow**. Pabaigoje santraukoje bus adresas,
   pvz. `https://durnius.jonas.workers.dev`.
6. Įrašyk adresą į `config.js` (`window.DURNIUS_SERVER = '...'`) – GitHub Pages atsinaujins pats.

## Lokaliai

```sh
cd server && npm install && npx wrangler dev
# žaidimas: http://localhost:8000/?server=http://127.0.0.1:8787
```

## Nustatymai

`wrangler.toml` → `ALLOWED_ORIGINS`: svetainės, iš kurių leidžiama jungtis (localhost leidžiamas visada).

## Protokolas

`wss://<serveris>/room/<KODAS>?role=host|guest&pid=<id>` – žr. komentarą `src/index.js` viršuje.
