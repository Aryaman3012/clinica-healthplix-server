// SSE consumer for clinica-portal's /api/practo/stream/:token. Ported from the extension's
// background.js. One StreamConsumer per clinic; reconnects with exponential backoff and
// dispatches parsed events to a handler. The handler must ack only on success (the consumer
// acks for you when the handler resolves without throwing).

import { config } from '../config.js';
import { ackEvent } from './register.js';

export class StreamConsumer {
  constructor(clinicId, streamToken, onEvent) {
    this.clinicId = clinicId;
    this.streamToken = streamToken;
    this.onEvent = onEvent; // async (eventType, payload) => void
    this.controller = null;
    this.stopped = false;
  }

  start() {
    if (this.controller) return;
    this.controller = new AbortController();
    this._loop();
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
  }

  async _loop() {
    const url = `${config.clinicaPortalUrl}/api/practo/stream/${this.streamToken}`;
    let backoff = 5000;

    while (!this.stopped) {
      try {
        const res = await fetch(url, { signal: this.controller.signal });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        backoff = 5000;
        console.log(`[stream:${this.clinicId}] connected`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (!this.stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          let eventType = '';
          let eventId = '';
          let dataLine = '';

          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('id:')) eventId = line.slice(3).trim();
            else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
            else if (line === '' && dataLine) {
              await this._handle(eventType, eventId, JSON.parse(dataLine));
              eventType = ''; eventId = ''; dataLine = '';
            }
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn(`[stream:${this.clinicId}] disconnected, retry in ${backoff / 1000}s: ${e.message}`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  async _handle(eventType, eventId, payload) {
    if (eventType === 'connected') {
      console.log(`[stream:${this.clinicId}] handshake:`, payload);
      return;
    }
    if (!eventId) return;

    try {
      await this.onEvent(eventType, payload);
      await ackEvent(this.streamToken, eventId);
      console.log(`[stream:${this.clinicId}] acked ${eventId} (${eventType})`);
    } catch (e) {
      // Do NOT ack — clinica-portal will redeliver. Surfaced for alerting.
      console.error(`[stream:${this.clinicId}] failed ${eventType} — not acking:`, e.message);
    }
  }
}
