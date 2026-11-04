import { formatMs, remainingMs, serverOffset, syncServerClock } from './clock';

describe('reloj sincronizado', () => {
  beforeEach(() => serverOffset.set(0));

  it('formatea mm:ss redondeando hacia arriba', () => {
    expect(formatMs(30 * 60 * 1000)).toBe('30:00');
    expect(formatMs(59_001)).toBe('01:00');
    expect(formatMs(0)).toBe('00:00');
  });

  it('usa el tiempo congelado cuando está en pausa', () => {
    expect(remainingMs({ status: 'paused', ends_at: null, paused_remaining_ms: 90_000 })).toBe(90_000);
  });

  it('corrige el desfase con el servidor', () => {
    syncServerClock(new Date(Date.now() + 60_000).toISOString());
    const endsAt = new Date(Date.now() + 120_000).toISOString();
    const r = remainingMs({ status: 'running', ends_at: endsAt, paused_remaining_ms: null });
    expect(r).toBeGreaterThan(59_000);
    expect(r).toBeLessThanOrEqual(60_100);
  });

  it('nunca devuelve negativo', () => {
    expect(remainingMs({ status: 'running', ends_at: new Date(Date.now() - 5000).toISOString(), paused_remaining_ms: null })).toBe(0);
  });
});
