export const SUITS = [
  { id: 'S', symbol: '♠', name: 'Pik' },
  { id: 'H', symbol: '♥', name: 'Herz', red: true },
  { id: 'C', symbol: '♣', name: 'Kreuz' },
  { id: 'D', symbol: '♦', name: 'Karo', red: true },
];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankNames = { J: 'Bube', Q: 'Dame', K: 'König', A: 'Ass' };
export const DECK = Object.freeze(SUITS.flatMap(suit => RANKS.map(rank => rank + suit.id)));
const cards = new Set(DECK);
export const rankOf = card => card.slice(0, -1);
export const isCard = card => cards.has(card);
export const teamOf = seat => seat % 2;

export function cardLabel(card) {
  const rank = rankOf(card);
  return SUITS.find(suit => suit.id === card.at(-1)).name + ' ' + (rankNames[rank] ?? rank);
}

export function shuffle(cardsToShuffle = DECK, random = Math.random) {
  const result = [...cardsToShuffle];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dealHands(deck, seats) {
  if (![2, 4].includes(seats) || deck.length % seats) {
    throw new Error('Die restlichen Karten müssen gleichmäßig aufteilbar sein.');
  }
  const count = Math.min(4, deck.length / seats);
  const hands = Array.from({ length: seats }, () => []);
  for (let card = 0; card < seats * count; card++) {
    hands[card % seats].push(deck[card]);
  }
  return { hands, deck: deck.slice(seats * count) };
}

export function newGame(seats, deck = shuffle()) {
  if (![2, 4].includes(seats) || deck.length !== 52 ||
      new Set(deck).size !== 52 || !deck.every(isCard)) {
    throw new Error('Zum Start werden zwei oder vier Plätze und ein vollständiges Deck benötigt.');
  }
  const table = deck.slice(0, 4);
  return {
    seats,
    ...dealHands(deck.slice(4), seats),
    table,
    publicCards: [...table],
    taken: [[], []],
    bonuses: [0, 0],
    turn: 0,
    lastCapture: null,
    lastMove: null,
    deal: 1,
    version: 0,
    finished: false,
  };
}

export function captureFor(table, card) {
  const matches = table.length > 0 && rankOf(table.at(-1)) === rankOf(card);
  const captures = table.length > 0 && (matches || rankOf(card) === 'J');
  const bonus = matches && table.length === 1 ? (rankOf(card) === 'J' ? 20 : 10) : 0;
  return { captures, bonus };
}

export function score(game) {
  return game.taken.map((pile, team) => ({
    cards: pile.length,
    bonus: game.bonuses[team],
    total: pile.length + game.bonuses[team],
  }));
}

export function playCard(game, seat, card) {
  if (game.finished || seat !== game.turn || !isCard(card) || !game.hands[seat]?.includes(card)) {
    return null;
  }
  const { captures, bonus } = captureFor(game.table, card);
  const playedPile = [...game.table, card];
  const hands = game.hands.map((hand, index) => index === seat ? hand.filter(item => item !== card) : hand);
  const next = {
    ...game,
    hands,
    table: captures ? [] : playedPile,
    publicCards: [...game.publicCards, card],
    taken: game.taken.map(pile => [...pile]),
    bonuses: [...game.bonuses],
    turn: (seat + 1) % game.seats,
    version: game.version + 1,
    lastMove: { seat, card, captures, bonus, collected: captures ? playedPile.length : 0, remainder: 0 },
  };
  if (captures) {
    next.lastCapture = seat;
    next.taken[teamOf(seat)].push(...playedPile);
    next.bonuses[teamOf(seat)] += bonus;
  }

  if (hands.every(hand => hand.length === 0)) {
    if (next.deck.length) {
      Object.assign(next, dealHands(next.deck, next.seats));
      next.deal++;
    } else {
      // A full game always has a capture: until the first capture the table
      // starts at four cards and never empties, so a played jack clears it.
      if (next.table.length && next.lastCapture !== null) {
        next.taken[teamOf(next.lastCapture)].push(...next.table);
        next.lastMove.remainder = next.table.length;
        next.table = [];
      }
      next.finished = true;
      next.turn = null;
    }
  }
  return next;
}

export function viewFor(game, seat) {
  if (!game.hands[seat]) throw new Error('Unbekannter Sitzplatz.');
  const scores = score(game);
  return {
    seat,
    seats: game.seats,
    hand: [...game.hands[seat]],
    handCounts: game.hands.map(hand => hand.length),
    table: [...game.table],
    publicCards: [...game.publicCards],
    collected: game.taken.map(pile => [...pile]),
    deckCount: game.deck.length,
    scores,
    turn: game.turn,
    lastMove: game.lastMove && { ...game.lastMove },
    deal: game.deal,
    version: game.version,
    finished: game.finished,
    winner: game.finished && scores[0].total !== scores[1].total
      ? Number(scores[1].total > scores[0].total)
      : null,
  };
}
