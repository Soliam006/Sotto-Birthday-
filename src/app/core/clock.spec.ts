import { elapsedMs, formatClock, formatMs, remainingMs, serverOffset, syncServerClock } from './clock';

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

  it('calcula el tiempo transcurrido sin contar las pausas', () => {
    expect(elapsedMs({ status: 'paused', ends_at: null, paused_remaining_ms: 1_500_000, duration_seconds: 1800 })).toBe(300_000);
    expect(elapsedMs({ status: 'idle', ends_at: null, paused_remaining_ms: null, duration_seconds: 1800 })).toBeNull();
    expect(elapsedMs({ status: 'finished', ends_at: null, paused_remaining_ms: null, duration_seconds: 1800 })).toBe(1_800_000);
    const endsAt = new Date(Date.now() + 25 * 60_000).toISOString();
    const e = elapsedMs({ status: 'running', ends_at: endsAt, paused_remaining_ms: null, duration_seconds: 1800 })!;
    expect(e).toBeGreaterThan(299_000);
    expect(e).toBeLessThanOrEqual(300_100);
  });

  it('formatea el minuto de prueba', () => {
    expect(formatClock(240)).toBe('4:00');
    expect(formatClock(65)).toBe('1:05');
  });
});
