import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OnlineSession, inviteFor } from '../game/online.js';
import { PROTOCOL, validSnapshot } from '../game/room.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, timeout = 1800) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert(predicate(), 'Zustand innerhalb der Wartezeit erreicht');
}

// This transport exercises both ends of the production session adapter.
// Each data message crosses a wire-like structured clone and an async boundary.
class Link extends EventEmitter {
  constructor(label) {
    super();
    this.label = label;
    this.open = false;
  }

  send(message) {
    if (!this.open) throw new Error('Link closed');
    const copy = structuredClone(message);
    queueMicrotask(() => {
      if (this.other.open) this.other.emit('data', copy);
    });
  }

  close() {
    this.open = this.other.open = false;
    queueMicrotask(() => {
      this.emit('close');
      this.other.emit('close');
    });
  }
}

function harness(t) {
  const peers = new Map();
  const sessions = [];
  let nextPeer = 0;
  class Peer extends EventEmitter {
    constructor(id = 'guest-' + nextPeer++) {
      super();
      this.id = id;
      this.links = new Set();
      peers.set(id, this);
      queueMicrotask(() => {
        this.open = true;
        this.emit('open', id);
      });
    }

    connect(id, { label }) {
      const link = new Link(label);
      const other = new Link(label);
      link.other = other;
      other.other = link;
      this.links.add(link);
      queueMicrotask(() => {
        const target = peers.get(id);
        if (!target) {
          this.emit('error', { type: 'peer-unavailable' });
          return;
        }
        target.links.add(other);
        target.emit('connection', other);
        link.open = other.open = true;
        other.emit('open');
        link.emit('open');
      });
      return link;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      peers.delete(this.id);
      for (const link of this.links) if (link.open) link.close();
      this.emit('close');
    }
  }

  function session() {
    const states = [];
    const statuses = [];
    const session = new OnlineSession({
      onState: data => states.push(data), onStatus: data => statuses.push(data), PeerClass: Peer,
    });
    sessions.push(session);
    return { session, states, statuses };
  }
  t.after(() => sessions.forEach(session => session.close()));
  return session;
}

function assertPublicState(sessions) {
  const views = sessions.map(({ session }) => session.snapshot.view);
  const handIds = views.flatMap(view => view.hand);
  assert.equal(new Set(handIds).size, handIds.length);
  for (const { session } of sessions) {
    const { snapshot, seat } = session;
    assert(validSnapshot(snapshot, seat));
    assert.deepEqual(snapshot.view.scores, views[0].scores);
    assert.deepEqual(snapshot.view.table, views[0].table);
    assert.deepEqual(snapshot.view.handCounts, views[0].handCounts);
    assert.equal(snapshot.view.version, views[0].version);
    assert(!('hands' in snapshot.view) && !('deck' in snapshot.view));
    assert(snapshot.players.every(player => !('token' in player)));
  }
}

test('Online-Duell vom Einladungslink bis zur Endwertung mit gültigen und ungültigen Aktionen', async t => {
  const create = harness(t);
  const host = create();
  const code = host.session.host(2, 'Host');
  const url = inviteFor(code, 'https://name.github.io/xeri/?obsolete#alt');
  assert.equal(url, 'https://name.github.io/xeri/?raum=' + code);
  const guest = create();
  guest.session.join(new URL(url).searchParams.get('raum'), 'Gast');
  await settle();
  assert.equal(guest.session.seat, 1);
  assert.equal(host.session.snapshot.players[1].name, 'Gast');
  host.session.start();
  await settle();
  assertPublicState([host, guest]);
  const guestCard = guest.session.snapshot.view.hand[0];
  const refused = guest.session.action(guestCard);
  guest.session.play(refused);
  await settle();
  assert(guest.statuses.some(status => status.rejected === refused.id));
  assert.equal(host.session.snapshot.view.version, 0);
  host.session.play(host.session.action(guestCard));
  assert.equal(host.session.snapshot.view.version, 0);

  for (let version = 0; version < 48; version++) {
    const actor = [host, guest][version % 2].session;
    const move = actor.action(actor.snapshot.view.hand[0]);
    actor.play(move);
    if (version === 1) {
      actor.play(move);
      actor.play({ ...move, id: false, card: 'NEW' });
    }
    await settle();
    assertPublicState([host, guest]);
    assert.equal(host.session.snapshot.view.version, version + 1);
  }
  assert(guest.session.snapshot.view.finished);
  assert.equal(guest.session.snapshot.view.scores.reduce((n, score) => n + score.cards, 0), 52);
  host.session.lobby();
  await settle();
  assert.equal(guest.session.snapshot.view, null);
  host.session.start();
  await settle();
  assert.equal(guest.session.snapshot.match, 2);
  assert.equal(guest.session.snapshot.view.version, 0);
});

test('Vier menschliche Sitze, volle Lobby, Zugreihenfolge und vollständiges 2vs2', async t => {
  const create = harness(t);
  const host = create();
  const code = host.session.host(4, 'Host');
  const seats = [host];
  for (let i = 1; i <= 3; i++) {
    const guest = create();
    guest.session.join(code, 'Spieler ' + (i + 1));
    await settle();
    assert.equal(guest.session.seat, i);
    seats.push(guest);
  }
  const overflow = create();
  overflow.session.join(code, 'Wartet');
  await settle();
  assert(overflow.statuses.some(info => info.terminal && info.text.includes('voll')));
  host.session.start();
  await settle();
  assertPublicState(seats);
  for (let move = 0; move < 48; move++) {
    const actor = seats[move % 4].session;
    assert.equal(actor.snapshot.view.turn, move % 4);
    actor.play(actor.action(actor.snapshot.view.hand[0]));
    await settle();
  }
  assertPublicState(seats);
  assert(seats.every(({ session }) => session.snapshot.view.finished));
  assert.equal(host.session.snapshot.view.scores.reduce((n, score) => n + score.cards, 0), 52);
});

test('2vs2 mit drei Bots und mit einem Bot läuft bis zum Schluss', async t => {
  const create = harness(t);
  for (const humanSeats of [1, 3]) {
    const host = create();
    const code = host.session.host(4, 'Host');
    const seats = [host];
    const timer = host.session.timer.bind(host.session);
    host.session.timer = (name, callback, ms) => timer(name, callback, name === 'bot' ? 1 : ms);
    for (let seat = 1; seat < humanSeats; seat++) {
      const guest = create();
      guest.session.join(code, 'Spieler ' + seat);
      seats.push(guest);
      await settle();
    }
    for (let seat = humanSeats; seat < 4; seat++) host.session.botAt(seat, true);
    host.session.botAt(humanSeats, false);
    host.session.start();
    assert.equal(host.session.snapshot.view, null);
    host.session.botAt(humanSeats, true);
    host.session.start();
    await settle();
    for (let round = 0; round < 12; round++) {
      for (let seat = 0; seat < humanSeats; seat++) {
        const actor = seats[seat].session;
        await until(() => actor.snapshot.view.turn === seat);
        actor.play(actor.action(actor.snapshot.view.hand[0]));
        await settle();
      }
    }
    await until(() => seats.every(({ session }) => session.snapshot.view.finished));
    assertPublicState(seats);
    assert.equal(host.session.snapshot.view.version, 48);
  }
});

test('Ein Verbindungsabbruch pausiert die Partie und der gleiche Sitz kann wieder beitreten', async t => {
  const create = harness(t);
  const host = create();
  const code = host.session.host(2, 'Host');
  const guest = create();
  guest.session.join(code, 'Gast');
  await settle();
  host.session.start();
  await settle();
  host.session.play(host.session.action(host.session.snapshot.view.hand[0]));
  await settle();
  const before = guest.session.snapshot.view;
  guest.session.connection.close();
  await settle();
  assert(!host.session.snapshot.players[1].connected);
  assert(guest.statuses.some(info => info.retry));
  const token = guest.session.token;
  const stranger = create();
  stranger.session.join(code, 'Fremd');
  await settle();
  assert(stranger.statuses.some(info => info.terminal && info.text.includes('bereits')));
  await until(() => guest.session.authenticated && host.session.snapshot.players[1].connected);
  assert.equal(guest.session.token, token);
  assert.deepEqual(guest.session.snapshot.view, before);
  guest.session.play(guest.session.action(before.hand[0]));
  await settle();
  assert.equal(host.session.snapshot.view.version, 2);
  host.session.close();
  await settle();
  assert(guest.statuses.some(status => status.terminal && status.text.includes('geschlossen')));
});

test('Fremde oder fehlerhafte Daten werden ignoriert bzw. abgewiesen', async t => {
  const create = harness(t);
  const host = create();
  const code = host.session.host(2, 'Host');
  const guest = create();
  guest.session.join(code, 'Gast');
  await settle();
  host.session.start();
  await settle();
  const current = guest.session.snapshot;
  const link = host.session.links.get(1);
  link.send({ ...current, protocol: PROTOCOL + 1, revision: 999 });
  link.send({ ...current, revision: 999, view: { ...current.view, hand: ['DOES NOT EXIST'] } });
  link.send({ ...current, revision: current.revision - 1 });
  guest.session.connection.send(null);
  guest.session.connection.send({ type: 'move', id: 'bad', match: 1, version: 0, card: 'AS' });
  await settle();
  assert.equal(guest.session.snapshot.revision, current.revision);
  assert.equal(host.session.snapshot.view.version, 0);
});
