import { HostRoom, isKey, isName, isNumber, isRecord, makeKey, PROTOCOL, validHello, validSnapshot } from './room.js';

const peerId = key => 'xeri-v1-' + key;
const channel = 'xeri-v1';
const timeToConnect = 12500;

export function inviteFor(key, url = location.href) {
  const link = new URL(url);
  link.search = '';
  link.hash = '';
  link.searchParams.set('raum', key);
  return link.href;
}

function guestToken(key) {
  const storageKey = 'xeri-seat-' + key;
  const fresh = makeKey();
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (isKey(existing)) return existing;
    sessionStorage.setItem(storageKey, fresh);
  } catch {
    // The open tab can still reconnect with the in-memory token.
  }
  return fresh;
}

function connectionMessage(error) {
  if (error?.type === 'peer-unavailable') return 'Der Raum ist momentan nicht erreichbar. Prüfe, ob der Host den Raum geöffnet hat.';
  if (error?.type === 'unavailable-id') return 'Der Raumcode ist bereits vergeben. Erstelle bitte einen neuen Raum.';
  if (error?.type === 'browser-incompatible') return 'Dieser Browser unterstützt keine Direktverbindungen per WebRTC.';
  if (error?.type === 'webrtc') return 'Die Direktverbindung ist fehlgeschlagen. Versuche es erneut oder wechsle das Netzwerk.';
  return 'Die Verbindung ist unterbrochen. Prüfe dein Netzwerk und versuche es erneut.';
}

export class OnlineSession {
  constructor({ onState, onStatus, PeerClass = globalThis.Peer }) {
    this.onState = onState;
    this.onStatus = onStatus;
    this.PeerClass = PeerClass;
    this.peer = null;
    this.connection = null;
    this.links = new Map();
    this.waiting = new Map();
    this.room = null;
    this.seat = null;
    this.revision = -1;
    this.snapshot = null;
    this.established = false;
    this.authenticated = false;
    this.closed = false;
    this.attempts = 0;
    this.timers = {};
  }

  status(text = '', retry = false, terminal = false) {
    this.onStatus({ text, retry, terminal });
  }

  timer(name, callback, ms) {
    this.clear(name);
    this.timers[name] = setTimeout(() => {
      delete this.timers[name];
      if (!this.closed) callback();
    }, ms);
  }

  clear(name) {
    clearTimeout(this.timers[name]);
    delete this.timers[name];
  }

  host(seats, name) {
    this.key = makeKey();
    this.seat = 0;
    this.room = new HostRoom(seats, name);
    this.connect();
    return this.key;
  }

  join(key, name) {
    if (!isKey(key) || !isName(name)) throw new Error('Einladungslink oder Spielername ungültig.');
    this.key = key;
    this.name = name;
    this.token = guestToken(key);
    this.connect();
  }

  connect() {
    if (this.closed) return;
    if (!this.PeerClass) {
      this.status('Der Onlinedienst konnte nicht geladen werden. Lade die Seite neu oder prüfe deine Internetverbindung.', false, true);
      return;
    }
    this.status(this.established || this.room && this.peer ? 'Verbindung wird wiederhergestellt …' : 'Verbindung wird aufgebaut …');
    if (this.room && this.peer && !this.peer.destroyed && this.peer.disconnected && this.established) {
      this.timer('connect', () => this.fail('Der Signalisierungsdienst antwortet gerade nicht.'), timeToConnect);
      this.peer.reconnect();
      return;
    }
    if (this.room && this.peer?.open) {
      this.status();
      return;
    }

    const oldPeer = this.peer;
    this.peer = null;
    this.connection = null;
    oldPeer?.destroy();
    this.authenticated = false;
    try {
      const peer = this.room ? new this.PeerClass(peerId(this.key)) : new this.PeerClass();
      this.peer = peer;
      this.timer('connect', () => this.fail('Der Verbindungsaufbau hat zu lange gedauert. Prüfe das Netzwerk oder versuche es erneut.'), timeToConnect);
      peer.on('open', () => {
        if (this.peer !== peer || this.closed) return;
        if (this.room) {
          this.clear('connect');
          this.clear('retry');
          this.attempts = 0;
          this.established = true;
          this.status();
          this.publish();
        } else if (!this.connection) {
          const connection = peer.connect(peerId(this.key), { reliable: true, serialization: 'json', label: channel });
          if (connection) this.openGuest(connection);
          else this.fail('Die Direktverbindung konnte nicht geöffnet werden.');
        }
      });
      peer.on('connection', connection => {
        if (this.peer !== peer || this.closed || !this.room) connection.close();
        else this.openHost(connection);
      });
      peer.on('error', error => {
        if (this.peer !== peer || this.closed) return;
        if (this.room && this.established && error?.type === 'webrtc') return;
        if (!this.room && this.authenticated && ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(error?.type)) return;
        this.fail(connectionMessage(error), ['unavailable-id', 'browser-incompatible', 'invalid-id'].includes(error?.type));
      });
      peer.on('disconnected', () => {
        if (this.peer !== peer || this.closed) return;
        if (this.room || !this.authenticated) this.fail('Die Verbindung zum Signalisierungsdienst ist unterbrochen.');
      });
      peer.on('close', () => {
        if (this.peer === peer && !this.closed) this.fail(this.room && this.established
          ? 'Der Raum wurde getrennt. Öffne über das Hauptmenü einen neuen Raum.'
          : 'Die Verbindung wurde beendet.', Boolean(this.room && this.established));
      });
    } catch {
      this.fail('Die Onlineverbindung konnte nicht gestartet werden.');
    }
  }

  fail(message, terminal = false) {
    this.clear('connect');
    if (terminal) this.clear('retry');
    if (!this.room) {
      const connection = this.connection;
      this.connection = null;
      this.authenticated = false;
      connection?.close();
    }
    if (!terminal && this.established && this.attempts < 3) {
      if (this.timers.retry) return;
      const delay = 1200 * (2 ** this.attempts++);
      this.status(message + ' Neuer Verbindungsversuch läuft …', true);
      this.timer('retry', () => this.connect(), delay);
    } else {
      this.status(message, !terminal, terminal);
    }
  }

  retry() {
    if (this.closed || this.authenticated) return;
    this.clear('retry');
    this.attempts = 0;
    this.connect();
  }

  send(connection, message) {
    if (!connection?.open) return false;
    try {
      connection.send(message);
      return true;
    } catch {
      return false;
    }
  }

  openHost(connection) {
    if (connection.label !== channel || this.waiting.size >= 12) {
      connection.close();
      return;
    }
    let seat = null;
    const cleanup = () => {
      clearTimeout(this.waiting.get(connection));
      this.waiting.delete(connection);
      if (this.closed || seat === null || this.links.get(seat) !== connection) return;
      this.links.delete(seat);
      this.room.disconnect(seat);
      this.publish();
    };
    this.waiting.set(connection, setTimeout(() => {
      cleanup();
      connection.close();
    }, timeToConnect));

    connection.on('data', message => {
      if (this.closed) return;
      if (seat === null) {
        if (!this.waiting.has(connection)) return;
        clearTimeout(this.waiting.get(connection));
        this.waiting.delete(connection);
        const result = validHello(message) ? this.room.join(message) : { ok: false, reason: 'Die Anmeldung war ungültig. Lade Xeri neu.' };
        if (!result.ok) {
          this.send(connection, { type: 'denied', reason: result.reason });
          setTimeout(() => connection.close(), 400);
          return;
        }
        seat = result.seat;
        const previous = this.links.get(seat);
        this.links.set(seat, connection);
        previous?.close();
        this.send(connection, { type: 'welcome', protocol: PROTOCOL, seat });
        this.publish();
        return;
      }
      if (this.links.get(seat) !== connection) return;
      if (isRecord(message) && message.type === 'leave') {
        this.links.delete(seat);
        this.room.disconnect(seat, true);
        connection.close();
        this.publish();
        return;
      }
      const result = this.room.move(seat, message);
      if (result.ok) this.publish();
      else {
        this.send(connection, { type: 'rejected', id: isKey(message?.id) ? message.id : null, reason: result.reason });
        this.send(connection, this.room.snapshot(seat));
      }
    });
    connection.on('close', cleanup);
    connection.on('error', () => {
      cleanup();
      connection.close();
    });
  }

  openGuest(connection) {
    this.connection = connection;
    const current = () => this.connection === connection && !this.closed;
    connection.on('open', () => {
      if (!current()) return;
      if (!this.send(connection, { type: 'hello', protocol: PROTOCOL, token: this.token, name: this.name })) {
        this.fail('Die Anmeldung im Raum konnte nicht gesendet werden.');
      }
    });
    connection.on('data', message => {
      if (!current() || !isRecord(message)) return;
      if (message.type === 'denied' && !this.authenticated && typeof message.reason === 'string') {
        this.fail(message.reason.slice(0, 200), true);
      } else if (message.type === 'ended') {
        const wasEstablished = this.established;
        this.fail(wasEstablished ? 'Der Host hat den Raum geschlossen.' : 'Dieser Raum wurde geschlossen.', true);
      } else if (message.type === 'welcome' && !this.authenticated && message.protocol === PROTOCOL && isNumber(message.seat, 1, 3)) {
        this.seat = message.seat;
        this.authenticated = true;
        this.revision = -1;
      } else if (this.authenticated && validSnapshot(message, this.seat) && message.revision >= this.revision) {
        this.clear('connect');
        this.clear('retry');
        this.attempts = 0;
        this.established = true;
        this.revision = message.revision;
        this.snapshot = message;
        this.status();
        this.onState(message);
      } else if (this.authenticated && message.type === 'rejected' &&
        isKey(message.id) && typeof message.reason === 'string') {
        this.onStatus({ text: message.reason.slice(0, 200), rejected: message.id });
      }
    });
    connection.on('close', () => {
      if (current()) this.fail('Die Verbindung zum Host ist unterbrochen.');
    });
    connection.on('error', error => {
      if (current()) this.fail(connectionMessage(error));
    });
  }

  publish() {
    this.snapshot = this.room.snapshot(0);
    for (const [seat, connection] of this.links) {
      this.send(connection, this.room.snapshot(seat));
    }
    this.onState(this.snapshot);
    this.clear('bot');
    if (this.room.ready && this.room.game && this.room.players[this.room.game.turn]?.bot) {
      this.timer('bot', () => {
        if (this.room.botMove()) this.publish();
      }, 650);
    }
  }

  botAt(seat, enabled) {
    if (this.room?.botAt(seat, enabled)) this.publish();
  }

  release(seat) {
    if (this.room?.release(seat)) this.publish();
  }

  start() {
    if (this.room?.start()) this.publish();
  }

  lobby() {
    if (this.room?.lobby()) this.publish();
  }

  action(card) {
    const id = makeKey();
    return { type: 'move', id, match: this.snapshot?.match, version: this.snapshot?.view?.version, card };
  }

  play(message) {
    if (this.room) {
      const result = this.room.move(0, message);
      if (result.ok) this.publish();
      else this.onStatus({ text: result.reason, rejected: message.id });
    } else if (!this.authenticated || !this.send(this.connection, message)) {
      this.fail('Dein Spielzug wurde nicht übertragen.');
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    Object.keys(this.timers).forEach(name => this.clear(name));
    for (const timer of this.waiting.values()) clearTimeout(timer);
    for (const connection of this.links.values()) this.send(connection, { type: 'ended' });
    this.send(this.connection, { type: 'leave' });
    const peer = this.peer;
    if (peer) setTimeout(() => peer.destroy(), 180);
  }
}
