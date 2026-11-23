import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFor, DECK, dealHands, newGame, playCard, score, shuffle, teamOf, viewFor } from '../game/engine.js';
import { chooseCard } from '../game/ai.js';

const rng = seed => () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function position(table, card) {
  return {
    seats: 2, hands: [[card], ['4H']], table, deck: [], publicCards: [...table],
    turn: 0, deal: 1, version: 0, finished: false, lastCapture: null,
    taken: [[], []], bonuses: [0, 0],
  };
}

test('Startstapel, Standarddeck und Austeilung für zwei und vier Spieler', () => {
  assert.equal(new Set(DECK).size, 52);
  for (const seats of [2, 4]) {
    const game = newGame(seats, DECK);
    assert.deepEqual(game.table, DECK.slice(0, 4));
    assert.deepEqual(game.hands[0], Array.from({ length: 4 }, (_, round) => DECK[4 + round * seats]));
    assert(game.hands.every(hand => hand.length === 4));
    assert.equal(game.deck.length, 48 - 4 * seats);
  }
  assert.throws(() => newGame(2, Array(52).fill('JS')));
});

test('Kürzere Schlussausteilungen sind gleichmäßig', () => {
  const partial = dealHands(DECK.slice(0, 12), 4);
  assert.deepEqual(partial.hands.map(hand => hand.length), [3, 3, 3, 3]);
  assert.deepEqual(partial.deck, []);
  assert.throws(() => dealHands(DECK.slice(0, 3), 2));
});

test('Gleicher Kartenwert und Bube räumen den vollständigen Stapel ab', () => {
  for (const card of ['9D', 'JC']) {
    const original = position(['AH', '9C'], card);
    const next = playCard(original, 0, card);
    assert.deepEqual(next.taken[0], ['AH', '9C', card]);
    assert.deepEqual(next.table, []);
    assert.equal(next.lastCapture, 0);
    assert.deepEqual(score(next)[0], { cards: 3, bonus: 0, total: 3 });
    assert.deepEqual(original.table, ['AH', '9C']);
    assert.deepEqual(original.hands[0], [card]);
  }
});

test('Einfache Xeri, Buben-Xeri und Bube ohne passenden Wert', () => {
  for (const [top, played, bonus] of [['9C', '9H', 10], ['JS', 'JH', 20], ['9C', 'JH', 0]]) {
    const next = playCard(position([top], played), 0, played);
    assert.deepEqual(next.taken[0], [top, played]);
    assert.deepEqual(score(next)[0], { cards: 2, bonus, total: 2 + bonus });
    assert.equal(next.lastMove.bonus, bonus);
  }
});

test('Ein Bube auf leerem Tisch eröffnet einen Stapel und sammelt keine Karte', () => {
  assert.deepEqual(captureFor([], 'JS'), { captures: false, bonus: 0 });
  const next = playCard(position([], 'JS'), 0, 'JS');
  assert.deepEqual(next.table, ['JS']);
  assert.deepEqual(next.taken[0], []);
  assert.equal(next.lastCapture, null);
});

test('Verschiedene Werte lassen den Stapel liegen und falsche Aktionen bleiben wirkungslos', () => {
  const original = position(['AS'], '8C');
  assert.equal(playCard(original, 1, '4H'), null);
  assert.equal(playCard(original, 0, '4H'), null);
  assert.equal(playCard(original, 0, { rank: 8 }), null);
  assert.deepEqual(playCard(original, 0, '8C').table, ['AS', '8C']);
});

test('Die Restkarten zählen beim letzten Abräumer und die Partner teilen sich die Wertung', () => {
  const original = {
    ...position(['3D'], '8C'),
    seats: 4, turn: 3, hands: [[], [], [], ['8C']], lastCapture: 2,
    taken: [['6C', '7C'], ['2H', '3H', '4H', '5H']], bonuses: [10, 0],
  };
  const next = playCard(original, 3, '8C');
  assert(next.finished);
  assert.deepEqual(next.table, []);
  assert.equal(next.lastMove.remainder, 2);
  assert.deepEqual(next.taken[0], ['6C', '7C', '3D', '8C']);
  assert.deepEqual(score(next), [{ cards: 4, bonus: 10, total: 14 }, { cards: 4, bonus: 0, total: 4 }]);
  assert.equal(viewFor(next, 1).winner, 0);
});

test('Gleichstand hat keinen Sieger', () => {
  const game = { ...newGame(2), finished: true, taken: [DECK.slice(0, 26), DECK.slice(26)] };
  assert.equal(viewFor(game, 0).winner, null);
});

test('Die KI bevorzugt sichere Xeri und trifft legale Entscheidungen aus der öffentlichen Ansicht', () => {
  const game = {
    ...position(['JS'], 'JC'),
    hands: [['JC', '3S', '4C', '7C'], ['4H']],
  };
  for (const level of ['medium', 'hard']) assert.equal(chooseCard(viewFor(game, 0), level, rng(2)), 'JC');
  assert.equal(chooseCard(viewFor(game, 0), 'easy', () => .5), '4C');
});

for (const seats of [2, 4]) {
  test(`60 vollständige Partien mit ${seats} Sitzen behalten alle Karten und korrekte Teamwertung`, () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = rng(seed);
      let game = newGame(seats, shuffle(DECK, random));
      const observedBonuses = [0, 0];
      const levels = ['easy', 'medium', 'hard'];
      while (!game.finished) {
        const expectedTurn = game.version % seats;
        assert.equal(game.turn, expectedTurn);
        const view = viewFor(game, expectedTurn);
        assert.deepEqual(view.hand, game.hands[expectedTurn]);
        assert.equal(view.publicCards.length, game.version + 4);
        assert(!('deck' in view) && !('hands' in view));
        const card = chooseCard(view, levels[(seed + expectedTurn) % levels.length], random);
        assert(game.hands[expectedTurn].includes(card));
        const previous = game;
        game = playCard(game, expectedTurn, card);
        assert(game);
        if (game.lastMove.bonus) observedBonuses[teamOf(expectedTurn)] += game.lastMove.bonus;
        const all = [...game.deck, ...game.table, ...game.hands.flat(), ...game.taken.flat()];
        assert.equal(all.length, 52);
        assert.equal(new Set(all).size, 52);
        if (game.deal !== previous.deal) {
          assert.equal(previous.hands.flat().length, 1);
          assert(game.hands.every(hand => hand.length === 4));
        }
      }
      assert.equal(game.version, 48);
      assert.equal(game.deal, 48 / (seats * 4));
      assert.equal(game.deck.length + game.table.length + game.hands.flat().length, 0);
      assert.deepEqual(game.bonuses, observedBonuses);
      for (const [team, sum] of score(game).entries()) {
        assert.equal(sum.total, game.taken[team].length + observedBonuses[team]);
      }
      assert.equal(playCard(game, 0, 'AS'), null);
    }
  });
}
