import { cardLabel, newGame, playCard, rankOf, SUITS, teamOf, viewFor } from './game/engine.js';
import { chooseCard } from './game/ai.js';
import { GameAudio } from './game/audio.js';
import { cardOrigin, flyCard, sweepPile } from './game/card-motion.js';
import { inviteFor, OnlineSession } from './game/online.js';
import { isKey, isName } from './game/room.js';

const main = document.querySelector('#main');
const rulesDialog = document.querySelector('#rules-dialog');
const confirmDialog = document.querySelector('#confirm-dialog');
const soundButton = document.querySelector('#sound-button');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const audio = new GameAudio();
const modes = [
  { id: 'solo', title: 'Gegen Computer', detail: 'Solo am Tisch', icon: '♠' },
  { id: 'duel', title: 'Online 1 vs. 1', detail: 'Ein privates Duell', icon: '♦' },
  { id: 'team', title: 'Online 2 vs. 2', detail: 'Zusammen im Team, mit Freunden oder Bots', icon: '♣' },
];
const levels = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
const seatsIcons = ['♠', '♦', '♣', '♥'];

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

let mode = 'solo';
let difficulty = 'medium';
let name = '';
let invite = new URL(location.href).searchParams.get('raum');
let badInvite = invite !== null && !isKey(invite);
if (badInvite) invite = null;
let online = null;
let local = null;
let network = {};
let notice = '';
let pending = null;
let pendingTimer;
let botTimer;
let resultTimer;
let resultDialog;
let confirmAction;
let copyMessage = '';
let localMatch = 0;
let shownSnapshot = null;
const queuedMoves = [];
let moveRun = null;
let refreshAfterMove = false;

function soundLabel() {
  soundButton.setAttribute('aria-pressed', String(audio.enabled));
  document.querySelector('#sound-icon').textContent = audio.enabled ? '♫' : '♪';
  document.querySelector('#sound-text').textContent = audio.enabled ? 'Ton an' : 'Ton aus';
}

function cardFace(card, options = {}) {
  const suit = SUITS.find(item => item.id === card.at(-1));
  const rank = rankOf(card);
  const button = options.playable;
  const tag = button ? 'button' : 'div';
  const label = button ? `type="button" data-action="play" data-key="${card}" aria-label="${cardLabel(card)} spielen"${options.enabled ? '' : ' disabled'}` :
    `role="img" aria-label="${cardLabel(card)}"`;
  const corner = `${rank}<i>${suit.symbol}</i>`;
  return `<${tag} class="card${suit.red ? ' red' : ''}${button ? ' playable' : ''}" style="--delay:${options.delay ?? 0}ms" ${label}>
    <span class="card-corner" aria-hidden="true">${corner}</span>
    <span class="card-symbol" aria-hidden="true">${suit.symbol}</span>
    <span class="card-corner opposite" aria-hidden="true">${corner}</span>
  </${tag}>`;
}

function cardBack(delay) {
  return `<span class="card card-back" style="--delay:${delay}ms" aria-hidden="true"></span>`;
}

function menu() {
  const options = modes.map(item => `
    <button class="mode" type="button" data-action="mode" data-key="${item.id}" aria-pressed="${mode === item.id}">
      <span class="mode-icon" aria-hidden="true">${item.icon}</span>
      <span><strong>${item.title}</strong><small>${item.detail}</small></span>
      <span class="mode-indicator" aria-hidden="true"></span>
    </button>`).join('');
  const settings = mode === 'solo' ? `
    <div><span id="difficulty-label" class="field-label">Schwierigkeit</span>
    <div class="difficulties" role="group" aria-labelledby="difficulty-label">
      ${Object.entries(levels).map(([id, label]) => `<button type="button" data-action="difficulty" data-key="${id}" aria-pressed="${id === difficulty}">${label}</button>`).join('')}
    </div></div>` : nameField();
  return `<div class="menu-layout">
    <section class="menu-preview felt" aria-labelledby="menu-title">
      <div class="menu-title"><h1 id="menu-title">XERI</h1><div class="title-line">ΞΕΡΗ</div></div>
      <div class="preview-cards" aria-hidden="true">${['KS', 'QH', 'AC', 'JD'].map(card => cardFace(card)).join('')}</div>
      <div class="table-ornament" aria-hidden="true"><span>♠</span><span>♦</span></div>
    </section>
    <section class="menu-panel" aria-labelledby="mode-title">
      <div><h2 id="mode-title">An den Tisch</h2><p class="panel-intro">Wähle deinen Spielmodus.</p></div>
      <div class="mode-list" role="group" aria-labelledby="mode-title">${options}</div>
      <form id="menu-form" class="menu-form" autocomplete="off">
        ${settings}
        <button type="submit" class="button gold full"><span class="menu-icon" aria-hidden="true">♠</span>${mode === 'solo' ? 'Partie starten' : 'Raum erstellen'}</button>
      </form>
      ${badInvite ? '<p role="alert">Dieser Einladungslink ist ungültig.</p>' : ''}
    </section>
  </div>`;
}

function nameField() {
  return `<div class="field"><label for="player-name">Dein Name</label>
    <input id="player-name" name="player" value="${escape(name)}" maxlength="24" placeholder="Spielername eingeben" required autocomplete="nickname">
  </div>`;
}

function joinPanel() {
  return `<section class="panel join-panel">
    <div><h1>Zum privaten Tisch</h1><p class="panel-intro">Du wurdest zu einer Xeri-Partie eingeladen.</p></div>
    <form id="join-form" class="menu-form">${nameField()}<button class="button gold full">Raum beitreten</button></form>
    <button type="button" class="button-link" data-action="home">Zum Hauptmenü</button>
  </section>`;
}

function networkNotice() {
  if (!network.text) return '';
  return `<div class="connection" role="status"><p>${escape(network.text)}</p>
    ${network.retry ? '<button class="button outline small" data-action="retry">Erneut verbinden</button>' : ''}
  </div>`;
}

function roomLobby(snapshot) {
  const host = Boolean(online.room);
  const heading = snapshot ? snapshot.seats === 4 ? 'Team-Lobby' : 'Duell-Lobby' : 'Privater Raum';
  const link = host && snapshot ? inviteFor(online.key) : '';
  const roster = snapshot?.players.map((player, seat) => {
    const status = seat === 0 ? 'Host' : player?.bot ? 'Computer' : player?.connected ? 'Verbunden' : player ? 'Getrennt' : 'Frei';
    const team = snapshot.seats === 4 ? ' · Team ' + 'AB'[teamOf(seat)] : '';
    const name = player ? escape(player.name) : `Platz ${seat + 1}`;
    const actions = host && seat > 0 ? `
      ${!player && snapshot.seats === 4 ? `<button class="button outline small" data-action="add-bot" data-key="${seat}" aria-label="Bot zu Platz ${seat + 1} hinzufügen">Bot hinzufügen</button>` : ''}
      ${player?.bot ? `<button class="button outline small" data-action="remove-bot" data-key="${seat}" aria-label="Bot von Platz ${seat + 1} entfernen">Entfernen</button>` : ''}
      ${player?.connected === false ? `<button class="button outline small" data-action="release" data-key="${seat}">Freigeben</button>` : ''}
    ` : '';
    return `<div class="roster-seat"><span class="roster-avatar" aria-hidden="true">${seatsIcons[seat]}</span>
      <div><strong>${name}${seat === online.seat ? ' (du)' : ''}</strong><small>${status}${team}</small></div>
      ${actions}</div>`;
  }).join('');
  const ready = snapshot?.players.every(player => player?.connected);
  return `<div class="room-layout"><section class="panel lobby">
    <div><h1>${heading}</h1><p class="panel-intro">${host ? 'Lade deine Mitspieler an den Tisch ein.' : 'Der Host startet, sobald alle Plätze bereit sind.'}</p></div>
    ${networkNotice()}
    ${link ? `<div class="invite-box">
      <div class="field"><label for="invite-link">Einladungslink</label><input readonly id="invite-link" value="${escape(link)}"></div>
      <button class="button outline" data-action="copy">${escape(copyMessage || 'Link kopieren')}</button>
      <div class="room-code">Raumcode <code>${online.key}</code></div>
    </div>` : ''}
    ${snapshot ? `<div class="lobby-roster" aria-label="Sitzplätze">${roster}</div>` : ''}
    <div class="lobby-footer">
      <p>${snapshot ? `${snapshot.players.filter(player => player?.connected).length} von ${snapshot.seats} Plätzen bereit` : ''}</p>
      <button class="button outline" data-action="home">${host || snapshot ? 'Raum verlassen' : 'Zum Hauptmenü'}</button>
      ${host && snapshot ? `<button class="button gold" data-action="online-start"${ready ? '' : ' disabled'}>Partie starten</button>` : ''}
    </div>
    <p class="network-note">Das Onlinespiel nutzt WebRTC. Firewalls oder eingeschränkte Netzwerke können die Verbindung blockieren.</p>
  </section></div>`;
}

function scoreName(snapshot, team) {
  return snapshot.view.seats === 4 ? 'Team ' + 'AB'[team] : snapshot.players[team].name;
}

function scoreboard(snapshot, showCollection = true) {
  const { view } = snapshot;
  const boxes = view.scores.map((score, team) => {
    const label = escape(scoreName(snapshot, team));
    return `<div class="score-box${teamOf(view.seat) === team ? ' mine' : ''}" data-team="${team}">
      <div class="score-top"><h3>${label}</h3><strong aria-label="${score.total} Punkte">${score.total}</strong></div>
      <div class="score-detail"><span>Karten <b>${score.cards}</b></span><span>Xeri-Bonus <b>+${score.bonus}</b></span></div>
    </div>`;
  }).join('');
  const collection = showCollection ? `<details class="collection">
    <summary>Gesammelte Karten</summary>
    ${view.collected.map((pile, team) => `<div class="collected-team"><strong>${escape(scoreName(snapshot, team))}</strong>
      ${pile.length ? `<div class="collected-cards">${pile.map(card => cardFace(card)).join('')}</div>` :
        '<p>Noch keine Karten</p>'}
    </div>`).join('')}
  </details>` : '';
  return `<aside class="panel score-panel" aria-label="Punktestand">
    <h2 class="score-heading">Punktestand</h2>${boxes}
    <div class="deck-info"><span>Deck <strong>${view.deckCount}</strong></span><span>Austeilung <strong>${view.deal}/${48 / (4 * view.seats)}</strong></span></div>
    ${collection}
  </aside>`;
}

function seatMarkup(snapshot, offset, position, canPlay) {
  const { players, view } = snapshot;
  const seat = (view.seat + offset) % view.seats;
  const player = players[seat];
  const own = offset === 0;
  const role = own ? 'Du' : view.seats === 4 && offset === 2 ? 'Partner' : 'Gegner';
  const hand = own ? `<div class="hand" aria-label="Deine Handkarten">${view.hand.map((card, index) =>
    cardFace(card, { playable: true, enabled: canPlay, delay: index * 41 })).join('')}</div>` :
    `<div class="opponent-hand" aria-label="${view.handCounts[seat]} verdeckte Handkarten">${Array.from(
      { length: view.handCounts[seat] }, (_, index) => cardBack(index * 38)).join('')}</div>`;
  return `<div class="board-seat seat-${position}${view.turn === seat ? ' active' : ''}${player.connected ? '' : ' offline'}" data-seat="${seat}">
    <div class="seat-label" title="${escape(player.name)} · ${role}"><span class="role-mark" aria-hidden="true">${seatsIcons[seat]}</span>
      <strong>${escape(player.name)}</strong><small>${own ? '' : role}</small>
    </div>${hand}</div>`;
}

function moveDescription(snapshot) {
  const { view, players } = snapshot;
  const move = view.lastMove;
  if (!move) return 'Der Eröffnungsstapel liegt bereit.';
  if (move.remainder) return `${move.remainder} Restkarten gingen an den letzten Abräumer.`;
  const who = move.seat === view.seat ? 'Du hast' : players[move.seat].name + ' hat';
  if (move.captures) return `${who} ${move.collected} Karten abgeräumt${move.bonus ? ` und ${move.bonus} Xeri-Bonuspunkte erhalten` : ''}.`;
  return `${who} ${cardLabel(move.card)} gespielt.`;
}

function isPaused(snapshot) {
  return Boolean(online && (snapshot.players.some(player => !player.connected) || (!online.room && !online.authenticated)));
}

function isPlayerTurn(snapshot, paused = isPaused(snapshot)) {
  const { view } = snapshot;
  return !paused && !view.finished && view.turn === view.seat;
}

function gameScreen(snapshot, {
  deal = false, moving = false, pendingDeal = false, table = snapshot.view.table,
  scoreSnapshot = snapshot, bonus = 0,
} = {}) {
  const { players, view } = snapshot;
  const otherMissing = players.some(player => !player.connected);
  const paused = isPaused(snapshot);
  const yourTurn = isPlayerTurn(snapshot, paused);
  const turnText = view.finished ? 'Partie beendet' : paused ? 'Partie pausiert' :
    yourTurn ? pending ? 'Spielzug wird gesendet …' : 'Du bist am Zug' : players[view.turn].name + ' ist am Zug';
  const missing = otherMissing && !network.text ? {
    text: 'Die Partie ist pausiert. Ein Mitspieler hat die Verbindung verloren. Der Platz bleibt für den Wiedereinstieg reserviert.',
  } : network;
  const gameName = online ? view.seats === 4 ? 'Online 2 vs. 2' : 'Online 1 vs. 1' : 'Gegen Computer';
  const flash = bonus ? `<div class="xeri-flash${bonus === 20 ? ' double' : ''}" aria-hidden="true">ΞΕΡΗ!<span>+${bonus} Punkte</span></div>` : '';
  const pile = table.length ? table.slice(-4).map(card => cardFace(card)).join('') :
    '<div class="table-empty" aria-hidden="true">♣</div>';
  const extra = view.finished ? `<button class="button gold" data-action="result"${moving ? ' disabled' : ''}>Ergebnis anzeigen</button>` :
    local ? '<button class="button outline small" data-action="new-local">Neues Spiel</button>' :
    online.room ? '<button class="button outline small" data-action="online-lobby">Zur Lobby</button>' :
    '<button class="button outline small" data-action="home">Raum verlassen</button>';
  return `<div class="game-header"><div><h1>${gameName}</h1><p>${online ? 'Privater Tisch' : 'Schwierigkeit · ' + levels[difficulty]}</p></div>${extra}</div>
    <div class="game-layout">
      ${missing.text ? `<div class="connection" role="status"><p>${escape(missing.text)}</p>${missing.retry ?
        '<button class="button outline small" data-action="retry">Erneut verbinden</button>' : ''}</div>` : ''}
      <section class="board felt${deal ? ' deal' : ''}${pendingDeal ? ' pending-deal' : ''}" aria-label="Kartentisch">
        ${seatMarkup(snapshot, view.seats / 2, 'top')}
        ${view.seats === 4 ? seatMarkup(snapshot, 1, 'left') + seatMarkup(snapshot, 3, 'right') : ''}
        <div class="table-center">
          <div class="turn-line" role="status">${escape(turnText)}</div>
          <div class="table-pile">${pile}${flash}</div>
          <div class="table-caption">${table.length === 1 ? '1 Karte' : table.length + ' Karten'} auf dem Tisch</div>
        </div>
        ${seatMarkup(snapshot, 0, 'bottom', yourTurn && !pending && !moving)}
      </section>
      ${scoreboard(scoreSnapshot)}
    </div>
    <div class="table-action" role="status">${escape(notice || moveDescription(scoreSnapshot))}</div>`;
}

function currentSnapshot() {
  if (online) return online.snapshot;
  if (!local) return null;
  return {
    match: localMatch,
    seats: 2,
    players: [{ name: 'Du', connected: true }, { name: 'Computer', connected: true }],
    view: viewFor(local, 0),
  };
}

function draw(snapshot, effect) {
  const focused = document.activeElement;
  const focusedAction = main.contains(focused) && focused.dataset.action;
  const focusedKey = focused?.dataset.key ?? '';
  const collectionOpen = main.querySelector('.collection')?.open;
  main.innerHTML = snapshot?.view ? gameScreen(snapshot, effect) :
    online ? roomLobby(snapshot) : invite ? joinPanel() : menu();
  const collection = main.querySelector('.collection');
  if (collection && collectionOpen) collection.open = true;
  if (focusedAction) {
    const same = [...main.querySelectorAll('[data-action]')].find(node =>
      node.dataset.action === focusedAction && (node.dataset.key ?? '') === focusedKey && !node.disabled);
    same?.focus({ preventScroll: true });
  }
}

function render() {
  if (moveRun) refreshAfterMove = true;
  else draw(shownSnapshot);
}

function cancelMoves() {
  queuedMoves.length = 0;
  moveRun?.abort();
  moveRun = null;
  refreshAfterMove = false;
}

function cleanUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('raum');
  history.replaceState(null, '', url.href);
}

function showMainMenu() {
  if (online) {
    const session = online;
    online = null;
    session.close();
  }
  clearPending();
  clearTimeout(botTimer);
  cancelMoves();
  closeResult();
  local = null;
  shownSnapshot = null;
  invite = null;
  badInvite = false;
  network = {};
  notice = '';
  copyMessage = '';
  cleanUrl();
  render();
  main.focus();
}

function confirm(title, copy, label, action) {
  confirmDialog.returnValue = 'cancel';
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-copy').textContent = copy;
  document.querySelector('#confirm-yes').textContent = label;
  confirmAction = action;
  confirmDialog.showModal();
}

function goHome() {
  const view = currentSnapshot()?.view;
  if (view && !view.finished) {
    confirm('Partie verlassen?', online?.room ? 'Wenn du als Host gehst, endet der Raum für alle.' :
      online ? 'Dein Platz bleibt reserviert. Die Partie pausiert bis zu deiner Rückkehr.' :
        'Der Fortschritt dieser Partie geht verloren.', 'Verlassen', showMainMenu);
  } else showMainMenu();
}

function closeResult() {
  clearTimeout(resultTimer);
  if (!resultDialog) return;
  resultDialog.close();
  resultDialog.remove();
  resultDialog = null;
}

function showResult() {
  const snapshot = currentSnapshot();
  if (!snapshot?.view?.finished || resultDialog?.open) return;
  closeResult();
  const { view, players } = snapshot;
  const winner = view.winner === null ? 'Unentschieden' : view.seats === 4 ?
    `Team ${'AB'[view.winner]} gewinnt` : view.winner === view.seat ? 'Du hast gewonnen!' : players[view.winner].name + ' gewinnt';
  resultDialog = document.createElement('dialog');
  resultDialog.className = 'result-dialog';
  resultDialog.setAttribute('aria-labelledby', 'result-title');
  resultDialog.innerHTML = `<div class="result-icon" aria-hidden="true">♠</div>
    <div class="dialog-top"><h2 id="result-title">${escape(winner)}</h2></div>
    ${scoreboard(snapshot, false)}
    <div class="dialog-actions">
      <form method="dialog"><button class="button outline">Zum Tisch</button></form>
      ${online?.room ? '<button class="button gold" data-action="online-lobby">Zur Lobby</button>' :
        local ? '<button class="button gold" data-action="new-local">Neues Spiel</button>' :
          '<button class="button gold" data-action="home">Raum verlassen</button>'}
    </div>`;
  document.body.append(resultDialog);
  resultDialog.showModal();
}

function setHandEnabled(enabled) {
  for (const card of main.querySelectorAll('.hand > button')) card.disabled = !enabled;
}

function scheduleResult(view, bonus = 0) {
  resultTimer = setTimeout(() => {
    if (!rulesDialog.open && !confirmDialog.open) showResult();
    if (view.winner === teamOf(view.seat)) audio.play('win');
  }, bonus ? 840 : 420);
}

async function playQueuedMoves() {
  const run = new AbortController();
  const { signal } = run;
  moveRun = run;
  try {
    // Network snapshots keep arriving while a move is painted. Consume them
    // in order so the next flight starts from the hand currently on screen.
    while (queuedMoves.length) {
      const snapshot = queuedMoves.shift();
      const before = shownSnapshot;
      const { view } = snapshot;
      const move = view.lastMove;
      const deal = view.deal !== before.view.deal;
      const clearsTable = move.captures || move.remainder > 0;
      const instant = document.hidden || reducedMotion.matches || typeof main.animate !== 'function';
      const origin = instant ? null : cardOrigin(main, before.view, move);
      let pile;
      let card;
      refreshAfterMove = false;
      if (origin?.width && origin.height) {
        draw(snapshot, {
          moving: true,
          pendingDeal: deal,
          table: clearsTable ? [...before.view.table, move.card] : view.table,
          scoreSnapshot: clearsTable ? before : snapshot,
        });
        pile = main.querySelector('.table-pile');
        card = pile.lastElementChild;
        await flyCard(card, origin, signal);
        if (signal.aborted) return;
      }

      audio.play(move.bonus === 20 ? 'double' : move.bonus ? 'xeri' : move.captures ? 'sweep' : 'play');
      if (card && clearsTable) {
        await sweepPile(pile, card, move.captures ? origin : null, signal);
        if (signal.aborted) return;
      }

      const latest = currentSnapshot();
      shownSnapshot = latest?.match === snapshot.match && latest.view?.version === view.version ? latest : snapshot;
      const moreMoves = queuedMoves.length > 0;
      if (!card || clearsTable || refreshAfterMove) {
        draw(shownSnapshot, { deal, moving: moreMoves, bonus: move.bonus });
      } else {
        if (deal) {
          const board = main.querySelector('.board');
          board.classList.remove('pending-deal');
          board.classList.add('deal');
        }
        setHandEnabled(!moreMoves && !pending && isPlayerTurn(shownSnapshot));
      }
      if (view.finished) scheduleResult(view, move.bonus);
    }
  } catch (error) {
    if (!signal.aborted) {
      console.error('Die Kartenanimation konnte nicht abgeschlossen werden.', error);
      queuedMoves.length = 0;
      shownSnapshot = currentSnapshot();
      draw(shownSnapshot);
      if (shownSnapshot?.view?.finished) scheduleResult(shownSnapshot.view);
    }
  } finally {
    if (moveRun === run) moveRun = null;
  }
}

function showUpdate(snapshot, prior) {
  const { view } = snapshot;
  const newMatch = !prior?.view || snapshot.match !== prior.match;
  const step = view && prior?.view ? view.version - prior.view.version : 0;
  if (!view || newMatch || (step !== 0 && step !== 1)) {
    cancelMoves();
    closeResult();
    shownSnapshot = snapshot;
    notice = '';
    draw(snapshot, { deal: view && (newMatch || view.deal !== prior.view.deal) });
    if (view?.finished) scheduleResult(view);
  } else if (step === 1) {
    notice = '';
    queuedMoves.push(snapshot);
    if (!moveRun) void playQueuedMoves();
  } else {
    if (!moveRun) shownSnapshot = snapshot;
    render();
  }
}

function startLocal() {
  closeResult();
  clearTimeout(botTimer);
  const prior = currentSnapshot();
  localMatch++;
  local = newGame(2);
  showUpdate(currentSnapshot(), prior);
  main.focus();
}

function localPlay(seat, card) {
  const prior = currentSnapshot();
  const next = playCard(local, seat, card);
  if (!next) return;
  local = next;
  showUpdate(currentSnapshot(), prior);
  if (next.turn === 1) {
    botTimer = setTimeout(() => {
      if (local === next) localPlay(1, chooseCard(viewFor(next, 1), difficulty));
    }, 490);
  }
}

function clearPending() {
  clearTimeout(pendingTimer);
  pending = null;
}

function setNetwork(status) {
  if (status.rejected) {
    if (pending?.id === status.rejected) clearPending();
    notice = status.text;
  } else {
    if (network.text === status.text && network.retry === status.retry) return;
    network = status;
    if (status.text) clearPending();
  }
  render();
}

function startOnline(seats) {
  let prior = null;
  const session = new OnlineSession({
    onStatus: status => { if (online === session) setNetwork(status); },
    onState: snapshot => {
      if (online !== session) return;
      if (pending && (snapshot.match !== pending.match || snapshot.view?.version !== pending.version || !snapshot.players.every(player => player?.connected))) {
        clearPending();
      }
      showUpdate(snapshot, prior);
      prior = snapshot;
    },
  });
  online = session;
  network = {};
  notice = '';
  copyMessage = '';
  if (seats) session.host(seats, name);
  else session.join(invite, name);
  render();
  main.focus();
}

async function copyInvite() {
  if (!online?.room) return;
  const session = online;
  const link = inviteFor(session.key);
  try {
    if (!navigator.clipboard) throw new Error('Zwischenablage ist nicht verfügbar.');
    await navigator.clipboard.writeText(link);
  } catch {
    const field = document.querySelector('#invite-link');
    if (!field || online !== session) return;
    field.focus();
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      // A marked link remains available for manual copying.
    }
    if (!copied) {
      copyMessage = 'Link markiert';
      const button = main.querySelector('[data-action="copy"]');
      if (button) button.textContent = copyMessage;
      return;
    }
  }
  if (online !== session) return;
  copyMessage = 'Link kopiert';
  render();
}

document.querySelector('#home-button').addEventListener('click', goHome);
document.querySelector('#rules-button').addEventListener('click', () => rulesDialog.showModal());
soundButton.addEventListener('click', () => {
  audio.toggle();
  soundLabel();
});
soundLabel();

confirmDialog.addEventListener('close', () => {
  const action = confirmAction;
  confirmAction = null;
  if (confirmDialog.returnValue === 'confirm') action?.();
});

main.addEventListener('input', event => {
  if (event.target.id === 'player-name') {
    event.target.setCustomValidity('');
    name = event.target.value;
  }
});

main.addEventListener('submit', event => {
  event.preventDefault();
  audio.unlock();
  if (event.target.id === 'menu-form' && mode === 'solo') {
    startLocal();
    return;
  }
  const field = event.target.elements.player;
  if (!field) return;
  name = field.value.trim();
  if (!isName(name)) {
    field.setCustomValidity('Bitte gib einen Namen mit 1 bis 24 Zeichen ein.');
    field.reportValidity();
    return;
  }
  startOnline(event.target.id === 'join-form' ? null : mode === 'team' ? 4 : 2);
});

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const { action, key } = button.dataset;
  switch (action) {
    case 'mode': mode = key; render(); break;
    case 'difficulty': difficulty = key; render(); break;
    case 'home': goHome(); break;
    case 'copy': copyInvite(); break;
    case 'retry': online?.retry(); break;
    case 'add-bot': online?.botAt(Number(key), true); break;
    case 'remove-bot': online?.botAt(Number(key), false); break;
    case 'release': online?.release(Number(key)); break;
    case 'online-start': audio.unlock(); online?.start(); break;
    case 'online-lobby':
      if (currentSnapshot()?.view.finished) online?.lobby();
      else confirm('Zur Lobby zurückkehren?', 'Die aktuelle Partie endet für alle Mitspieler.', 'Zur Lobby', () => online?.lobby());
      break;
    case 'new-local':
      if (local?.finished) startLocal();
      else confirm('Neue Partie starten?', 'Der Fortschritt dieser Partie geht verloren.', 'Neu starten', startLocal);
      break;
    case 'result': showResult(); break;
    case 'play': {
      audio.unlock();
      if (local) localPlay(0, key);
      else if (online && !pending) {
        const session = online;
        pending = session.action(key);
        pendingTimer = setTimeout(() => {
          if (online === session && pending) session.fail('Der Tisch hat deinen Spielzug noch nicht bestätigt.');
        }, 9000);
        const message = pending;
        // Keep the rendered hand in place until the host accepts this move.
        setHandEnabled(false);
        if (!session.room) main.querySelector('.turn-line').textContent = 'Spielzug wird gesendet …';
        session.play(message);
      }
      break;
    }
  }
});

window.addEventListener('beforeunload', event => {
  const view = currentSnapshot()?.view;
  if (view && !view.finished) {
    event.preventDefault();
    event.returnValue = '';
  }
});

render();
