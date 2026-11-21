// =====================================================================
//  Paperfold levels. Wall rows are written top to bottom; the strip runs
//  left wall (front->back), back wall (left->right), right wall (back->front).
//  Every level is checked by test_levels.js with the solver.
// =====================================================================
(function (root) {
const LEVELS = [
  {
    name: 'Into the Wall',
    hint: 'Walk into the glowing portal on the wall. Inside the wall you can climb one block at a time.',
    floor: [
      '...#E',
      '....#',
      '.....',
      '.P...',
    ],
    wall: [
      '             ',
      '             ',
      '             ',
      '     O  O    ',
    ],
  },
  {
    name: 'Mind the Gap',
    hint: 'A pit in the floor is a gap in the wall. Push the crate into the pit to fill it.',
    floor: [
      '.....',
      '_C...',
      '#....',
      'E#.P.',
    ],
    wall: [
      '             ',
      '             ',
      '             ',
      'O    O       ',
    ],
  },
  {
    name: 'A Step Up',
    hint: 'A crate pushed against the wall becomes a step inside it.',
    floor: [
      '......',
      '..C..#',
      '....#E',
      '.P...#',
    ],
    wall: [
      '              ',
      '              ',
      '        =     ',
      '     O  =   O ',
    ],
  },
  {
    name: 'Pressure',
    hint: 'Plates open doors of the same colour while something stands on them.',
    floor: [
      '#E#...',
      '#A#...',
      '......',
      'P.C..a',
    ],
    wall: [
      '              ',
      '              ',
      '              ',
      '              ',
    ],
  },
  {
    name: 'Pull the Lever',
    hint: 'Levers in the wall switch things in the room. Press up (or swipe up) to pull one.',
    floor: [
      '.P...',
      '##A##',
      '.....',
      '..E..',
    ],
    wall: [
      '             ',
      '             ',
      '       L     ',
      '     O =     ',
    ],
  },
  {
    name: 'Hold It Down',
    hint: 'When you step into the wall, you step off the plate too.',
    floor: [
      '..y.#E',
      '.##..#',
      '.C..b.',
      'P.....',
    ],
    wall: [
      '              ',
      '              ',
      '              ',
      '     O    O   ',
    ],
  },
  {
    name: 'Blink',
    hint: 'Swirling pads are linked: step on one, appear on the other.',
    floor: [
      '#t.C.a#',
      '#######',
      '....#AE',
      'PT....#',
    ],
    wall: [
      '               ',
      '               ',
      '               ',
      '               ',
    ],
  },
  {
    name: 'Around the Corner',
    hint: 'The walls are joined at the corners. One long path wraps around the room.',
    floor: [
      '.._..',
      '.C...',
      '..C.#',
      '.P.#E',
    ],
    wall: [
      '             ',
      '             ',
      '        =    ',
      ' O      =   O',
    ],
  },
  {
    name: 'Switchback',
    hint: 'A crate left on a bridge drops into the pit when the bridge switches off.',
    floor: [
      '....#E',
      'xxxx##',
      '..AC..',
      'P.....',
    ],
    wall: [
      '              ',
      '              ',
      '      r       ',
      'LO    r  O    ',
    ],
  },
  {
    name: 'Long Distance',
    hint: 'Crates travel through the linked pads too.',
    floor: [
      '..#t#E',
      '...#.#',
      '.C....',
      '..T...',
      'P.....',
    ],
    wall: [
      '                ',
      '                ',
      '         =      ',
      '      O   O     ',
    ],
  },
  {
    name: 'Three Crates',
    hint: 'Every crate has a job. Plan before you push.',
    floor: [
      '..y...',
      '....._',
      '.C.C..',
      '..C.b#',
      'P...#E',
    ],
    wall: [
      '                ',
      '                ',
      '         =      ',
      '      O  =     O',
    ],
  },
  {
    name: 'Paperfold',
    hint: 'Everything you have learned, all at once.',
    floor: [
      '#._....',
      'x....#y',
      '.C.C...',
      '..C.b.#',
      'P....#E',
    ],
    wall: [
      '                 ',
      '                 ',
      '         r       ',
      'L O      r      O',
    ],
  },
];
if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS; else root.PF_LEVELS = LEVELS;
})(typeof self !== 'undefined' ? self : this);
