'use strict';
/** The sound effects a viewer can put inside a text-to-speech message, like  "good luck [airhorn] you will need it". Files: sounds/tts/<name>.wav (made by _build/make_tts_sfx.py). */
const LIST = [['ding', 'a bright ding'], ['bell', 'a ringing bell'], ['airhorn', 'da-da-DAAA airhorn'], ['rimshot', 'ba-dum-tss'], ['trombone', 'sad trombone'], ['boing', 'a springy boing'], ['whoosh', 'a whoosh'], ['laser', 'a laser zap'],
  ['coin', 'an arcade coin'], ['powerup', 'a power-up jingle'], ['powerdown', 'a power-down'], ['boom', 'an explosion'], ['drumroll', 'a drum roll with a cymbal'], ['tada', 'ta-da fanfare'], ['buzzer', 'a wrong-answer buzzer'],
  ['crickets', 'awkward crickets'], ['applause', 'applause'], ['pop', 'a pop'], ['siren', 'a siren'], ['sparkle', 'a sparkle']].map(([name, desc]) => ({ name, desc }));
module.exports = { LIST, NAMES: new Set(LIST.map((x) => x.name)) };
