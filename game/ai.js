import { captureFor, DECK, rankOf, teamOf } from './engine.js';

const randomCard = (hand, random) => hand[Math.floor(random() * hand.length)];

function chanceOfMatch(unseen, target, handSize, jackAlso = false) {
  const matches = unseen.filter(card => rankOf(card) === target || (jackAlso && rankOf(card) === 'J')).length;
  let miss = 1;
  for (let draw = 0; draw < Math.min(handSize, unseen.length); draw++) {
    miss *= Math.max(0, unseen.length - matches - draw) / (unseen.length - draw);
  }
  return 1 - miss;
}

// A bot receives exactly the same projection as the person at its seat.
export function chooseCard(view, difficulty, random = Math.random) {
  const { hand, table, publicCards, scores, seat, seats, handCounts } = view;
  if (hand.length === 0) return null;
  if (hand.length === 1 || (difficulty === 'easy' && random() < 0.88)) return randomCard(hand, random);

  const hard = difficulty === 'hard';
  const nextSeat = (seat + 1) % seats;
  const teammate = seats === 4 ? (seat + 2) % seats : seat;
  const known = new Set([...publicCards, ...hand]);
  const unseen = DECK.filter(card => !known.has(card));
  const team = teamOf(seat);
  const behind = scores[1 - team].total - scores[team].total;
  const cardsLeft = view.deckCount + handCounts.reduce((sum, count) => sum + count, 0);
  const isLastMove = cardsLeft === 1;

  let bestCard = null;
  let bestValue = -Infinity;
  for (const card of hand) {
    const rank = rankOf(card);
    const { captures, bonus } = captureFor(table, card);
    const pileValue = table.length + 1;
    let value = captures ? pileValue + bonus * (hard && behind > 8 ? 1.15 : 1) : 0;
    if (rank === 'J' && !isLastMove && !bonus) {
      value -= captures ? (hard ? 2.8 : 1.3) : (hard ? 5 : 3);
    }

    if (!captures && !isLastMove) {
      const nextHandSize = handCounts[nextSeat] || (view.deckCount > 0 ? Math.min(4, view.deckCount / seats) : 0);
      const xeriRisk = table.length === 0 ? (rank === 'J' ? 20 : 10) : 0;
      if (hard) {
        const clearChance = chanceOfMatch(unseen, rank, nextHandSize, true);
        const matchChance = chanceOfMatch(unseen, rank, nextHandSize);
        value -= 0.85 * (clearChance * (pileValue + 1) + matchChance * xeriRisk);
        if (seats === 4) {
          const teamChance = chanceOfMatch(unseen, rank, handCounts[teammate], true);
          value += 0.42 * (1 - clearChance) * teamChance * (pileValue + 2);
        }
        value += hand.some(other => other !== card && rankOf(other) === rank) ? 0.45 : 0;
      } else {
        const remainingOfRank = unseen.filter(other => rankOf(other) === rank).length;
        value -= remainingOfRank * (table.length ? 0.12 : 0.7);
      }
    }
    value += random() * (hard ? 0.12 : 0.4);
    if (value > bestValue) {
      bestCard = card;
      bestValue = value;
    }
  }
  return bestCard;
}
