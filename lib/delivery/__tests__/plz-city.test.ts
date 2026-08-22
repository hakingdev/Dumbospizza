import { describe, it, expect, vi, afterEach } from 'vitest';
import { LOCAL_PLZ_CITY, isValidPlz, lookupCityByPlz } from '../plz-city';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isValidPlz', () => {
  it('принимает ровно 5 цифр', () => {
    expect(isValidPlz('97688')).toBe(true);
    expect(isValidPlz('9768')).toBe(false);
    expect(isValidPlz('976880')).toBe(false);
    expect(isValidPlz('97a88')).toBe(false);
    expect(isValidPlz('')).toBe(false);
  });
});

describe('lookupCityByPlz', () => {
  it('локальные PLZ резолвятся без сети', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupCityByPlz('97688')).toBe('Bad Kissingen');
    expect(await lookupCityByPlz('97717')).toBe('Euerdorf');
    expect(await lookupCityByPlz('97708')).toBe('Bad Bocklet');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('невалидный PLZ → null без сети', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupCityByPlz('abc')).toBe(null);
    expect(await lookupCityByPlz('123')).toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('неизвестный PLZ уходит в Zippopotam и берёт place name', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [{ 'place name': 'Würzburg' }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupCityByPlz('97070')).toBe('Würzburg');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('zippopotam.us/de/97070');
  });

  it('Zippopotam упал → фолбэк на Nominatim; результат кэшируется', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ address: { town: 'Hammelburg' } }],
      });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupCityByPlz('97071')).toBe('Hammelburg');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('nominatim.openstreetmap.org');
    // повторный вызов — из кэша, без новых fetch
    expect(await lookupCityByPlz('97071')).toBe('Hammelburg');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('оба сервиса без результата → null (и тоже кэш)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupCityByPlz('11111')).toBe(null);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Zippopotam + Nominatim
    expect(await lookupCityByPlz('11111')).toBe(null);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('справочник покрывает весь Landkreis Bad Kissingen', () => {
    expect(Object.keys(LOCAL_PLZ_CITY).length).toBeGreaterThanOrEqual(20);
    expect(LOCAL_PLZ_CITY['97688']).toBe('Bad Kissingen');
  });
});
