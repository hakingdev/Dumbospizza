/**
 * PLZ → город для автоподстановки поля «Ort» в checkout.
 *
 * Локальный справочник покрывает Landkreis Bad Kissingen и соседей (зона
 * доставки) без сетевых запросов; остальные PLZ уходят во внешний lookup
 * (Zippopotam → Nominatim) с кэшем в памяти процесса. Поле остаётся
 * редактируемым: у PLZ, разделённых несколькими Gemeinden (напр. 97717 —
 * Euerdorf/Sulzthal/Aura), подставляется основной населённый пункт.
 */

export const LOCAL_PLZ_CITY: Record<string, string> = {
  '97688': 'Bad Kissingen',
  '97702': 'Münnerstadt',
  '97705': 'Burkardroth',
  '97708': 'Bad Bocklet',
  '97711': 'Maßbach',
  '97714': 'Oerlenbach',
  '97717': 'Euerdorf',
  '97720': 'Nüdlingen',
  '97723': 'Oberthulba',
  '97725': 'Elfershausen',
  '97727': 'Fuchsstadt',
  '97762': 'Hammelburg',
  '97769': 'Bad Brückenau',
  '97772': 'Wildflecken',
  '97779': 'Geroda',
  '97786': 'Motten',
  '97789': 'Oberleichtersbach',
  '97792': 'Riedenberg',
  '97795': 'Schondra',
  '97797': 'Wartmannsroth',
  '97799': 'Zeitlofs',
  '97616': 'Bad Neustadt an der Saale',
};

export function isValidPlz(plz: string): boolean {
  return /^\d{5}$/.test(plz);
}

const FETCH_TIMEOUT_MS = 4000;

// null тоже кэшируем: неизвестный PLZ не должен долбить внешние API на каждый ввод.
const lookupCache = new Map<string, string | null>();

async function fetchZippopotam(plz: string): Promise<string | null> {
  const res = await fetch(`https://api.zippopotam.us/de/${plz}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const place = Array.isArray(data?.places) ? data.places[0] : null;
  const name = place?.['place name'];
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function fetchNominatim(plz: string): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=de&postalcode=${plz}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'DumbosPizza/1.0 (info@dumbospizza.de)',
      'Accept-Language': 'de',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const results = await res.json();
  const a = Array.isArray(results) ? results[0]?.address : null;
  const name = a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? a?.hamlet;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * Город по PLZ: локальный справочник → кэш → Zippopotam → Nominatim.
 * Ошибки внешних сервисов глотаются (null) — checkout оставит поле как есть.
 */
export async function lookupCityByPlz(plz: string): Promise<string | null> {
  if (!isValidPlz(plz)) return null;
  const local = LOCAL_PLZ_CITY[plz];
  if (local) return local;
  if (lookupCache.has(plz)) return lookupCache.get(plz) ?? null;

  let city: string | null = null;
  try {
    city = await fetchZippopotam(plz);
  } catch {
    city = null;
  }
  if (!city) {
    try {
      city = await fetchNominatim(plz);
    } catch {
      city = null;
    }
  }
  lookupCache.set(plz, city);
  return city;
}
