import { isCard, newGame, playCard, viewFor } from './engine.js';
import { chooseCard } from './ai.js';

export const PROTOCOL = 1;
export const isKey = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
export const makeKey = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isName = value => typeof value === 'string' && value.trim() === value &&
  value.length >= 1 && value.length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(value);
export const isNumber = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const bad = reason => ({ ok: false, reason });

export function validMove(message) {
  return isRecord(message) && message.type === 'move' && isKey(message.id) && isCard(message.card) &&
    isNumber(message.version, 0, 47) && Number.isSafeInteger(message.match) && message.match > 0;
}

export function validHello(message) {
  return isRecord(message) && message.type === 'hello' && message.protocol === PROTOCOL &&
    isKey(message.token) && isName(message.name);
}

function validScore(score) {
  return isRecord(score) && isNumber(score.cards, 0, 52) && isNumber(score.bonus, 0, 480) &&
    score.bonus % 10 === 0 && score.total === score.cards + score.bonus;
}

const cardList = (list, minimum, maximum) => Array.isArray(list) && isNumber(list.length, minimum, maximum) &&
  [...list].every(isCard) && new Set(list).size === list.length;

function validView(view, seat, seats) {
  if (!isRecord(view) || view.seat !== seat || view.seats !== seats ||
    typeof view.finished !== 'boolean' || !isNumber(view.version, 0, 48) ||
    !isNumber(view.deal, 1, 48 / (seats * 4)) || !isNumber(view.deckCount, 0, 48) ||
    !cardList(view.hand, 0, 4) || !cardList(view.table, 0, 52) || !cardList(view.publicCards, 4, 52) ||
    !Array.isArray(view.handCounts) || view.handCounts.length !== seats ||
    ![...view.handCounts].every(count => isNumber(count, 0, 4)) || view.handCounts[seat] !== view.hand.length ||
    !Array.isArray(view.scores) || view.scores.length !== 2 || ![...view.scores].every(validScore) ||
    (view.finished ? view.turn !== null : !isNumber(view.turn, 0, seats - 1))) return false;

  if (!Array.isArray(view.collected) || view.collected.length !== 2 ||
    ![...view.collected].every(pile => cardList(pile, 0, 52))) return false;
  const publicCards = new Set(view.publicCards);
  const visiblePiles = [...view.table, ...view.collected.flat()];
  if (view.publicCards.length !== view.version + 4 ||
    visiblePiles.length !== publicCards.size || new Set(visiblePiles).size !== publicCards.size ||
    !visiblePiles.every(card => publicCards.has(card)) || view.hand.some(card => publicCards.has(card)) ||
    view.collected.some((pile, team) => pile.length !== view.scores[team].cards) ||
    view.deckCount + view.handCounts.reduce((sum, count) => sum + count, 0) + publicCards.size !== 52) return false;

  const [a, b] = view.scores;
  const winner = view.finished && a.total !== b.total ? Number(b.total > a.total) : null;
  if (view.winner !== winner) return false;
  if (view.version === 0) return view.lastMove === null;
  const move = view.lastMove;
  return isRecord(move) && isNumber(move.seat, 0, seats - 1) && isCard(move.card) &&
    typeof move.captures === 'boolean' && [0, 10, 20].includes(move.bonus) &&
    isNumber(move.collected, 0, 52) && isNumber(move.remainder, 0, 52);
}

export function validSnapshot(message, seat) {
  if (!isRecord(message) || message.type !== 'snapshot' || message.protocol !== PROTOCOL ||
    !Number.isSafeInteger(message.revision) || message.revision < 0 ||
    !Number.isSafeInteger(message.match) || message.match < 0 ||
    ![2, 4].includes(message.seats) || !isNumber(seat, 0, message.seats - 1) ||
    !Array.isArray(message.players) || message.players.length !== message.seats) return false;

  if (!message.players[0] || !message.players[seat] ||
    ![...message.players].every(player => player === null ||
      (isRecord(player) && isName(player.name) && typeof player.bot === 'boolean' &&
        typeof player.connected === 'boolean'))) return false;

  return message.view === null || (message.match > 0 && message.players.every(Boolean) &&
    validView(message.view, seat, message.seats));
}

export class HostRoom {
  constructor(seats, name) {
    if (![2, 4].includes(seats) || !isName(name)) throw new Error('Ungültiger Raum.');
    this.players = Array(seats).fill(null);
    this.players[0] = { name, connected: true, bot: false };
    this.game = null;
    this.match = 0;
    this.revision = 0;
    this.usedMoves = new Set();
  }

  join({ token, name }) {
    if (!isKey(token) || !isName(name)) return bad('Die Anmeldung war ungültig.');
    const previous = this.players.findIndex(player => player?.token === token);
    if (previous >= 0) {
      this.players[previous].connected = true;
      this.revision++;
      return { ok: true, seat: previous };
    }
    if (this.game) return bad('Die Partie läuft bereits. Bitte lass dir einen neuen Raumlink schicken.');
    const seat = this.players.indexOf(null);
    if (seat < 0) return bad('Der Raum ist voll.');
    this.players[seat] = { token, name, connected: true, bot: false };
    this.revision++;
    return { ok: true, seat };
  }

  disconnect(seat, leave = false) {
    const player = this.players[seat];
    if (seat === 0 || !player || player.bot) return;
    if (!this.game && leave) this.players[seat] = null;
    else player.connected = false;
    this.revision++;
  }

  botAt(seat, enabled) {
    if (this.game || this.players.length !== 4 || !isNumber(seat, 1, 3)) return false;
    if (enabled && this.players[seat] === null) {
      this.players[seat] = { name: 'Bot ' + (seat + 1), bot: true, connected: true };
    } else if (!enabled && this.players[seat]?.bot) {
      this.players[seat] = null;
    } else return false;
    this.revision++;
    return true;
  }

  release(seat) {
    if (this.game || !isNumber(seat, 1, this.players.length - 1) ||
      this.players[seat]?.connected !== false) return false;
    this.players[seat] = null;
    this.revision++;
    return true;
  }

  get ready() {
    return this.players.every(player => player?.connected);
  }

  start() {
    if (!this.ready || (this.game && !this.game.finished)) return false;
    this.game = newGame(this.players.length);
    this.match++;
    this.revision++;
    this.usedMoves.clear();
    return true;
  }

  lobby() {
    if (!this.game) return false;
    this.game = null;
    this.revision++;
    return true;
  }

  move(seat, message) {
    if (!validMove(message)) return bad('Der Spielzug war ungültig.');
    if (!this.game || this.game.finished || !this.ready || !this.players[seat]?.connected) {
      return bad('Die Partie ist gerade pausiert oder beendet.');
    }
    if (message.match !== this.match || message.version !== this.game.version || this.usedMoves.has(message.id)) {
      return bad('Dein Tisch wurde aktualisiert. Wähle die Karte erneut.');
    }
    const next = playCard(this.game, seat, message.card);
    if (!next) return bad('Diese Karte kannst du gerade nicht spielen.');
    this.usedMoves.add(message.id);
    this.game = next;
    this.revision++;
    return { ok: true };
  }

  botMove() {
    if (!this.ready || !this.game || this.game.finished || !this.players[this.game.turn]?.bot) return false;
    const seat = this.game.turn;
    const card = chooseCard(viewFor(this.game, seat), 'hard');
    return this.move(seat, this.action(card)).ok;
  }

  action(card) {
    return { type: 'move', id: makeKey(), match: this.match, version: this.game?.version, card };
  }

  snapshot(seat) {
    if (!this.players[seat]) throw new Error('Der Platz ist unbesetzt.');
    return {
      type: 'snapshot',
      protocol: PROTOCOL,
      revision: this.revision,
      match: this.match,
      seats: this.players.length,
      players: this.players.map(player => player && ({
        name: player.name, bot: player.bot, connected: player.connected,
      })),
      view: this.game ? viewFor(this.game, seat) : null,
    };
  }
}
