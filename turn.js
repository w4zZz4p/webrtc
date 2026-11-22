// Papildomi TURN (persiuntimo) serveriai. Jų reikia, kai telefonai negali susijungti tiesiogiai,
// pvz. kai WiFi neleidžia įrenginiams matyti vienas kito (client isolation).
//
// 1 variantas – Metered (nemokamai 20 GB/mėn., https://www.metered.ca/stun-turn):
//   užsiregistruok, sukurk aplikaciją ir įrašyk jos pavadinimą bei API raktą:
//     meteredApp: 'mano-app',   // iš adreso mano-app.metered.live
//     meteredKey: 'xxxxxxxx',
// 2 variantas – bet kokie statiniai TURN serveriai (pvz. ExpressTURN, savas coturn):
//     iceServers: [{ urls: 'turn:host:3478', username: 'vartotojas', credential: 'slaptažodis' }],
window.TURN_CONFIG = {
  meteredApp: '',
  meteredKey: '',
  iceServers: [],
};
