"use client";

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';
import { sortZonesForList } from '../../../lib/delivery/zone-match';

// Карта — только на клиенте (Leaflet использует window).
const DeliveryZoneMap = dynamic(() => import('../../../components/delivery/DeliveryZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[460px] w-full rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

export default function DeliveryPage() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [zones, setZones] = useState<any[]>([]);
  const [restaurantCoords, setRestaurantCoords] = useState<{ lat: number; lng: number }>({
    lat: 50.2006,
    lng: 10.0767,
  });
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  // Выбранная зона (клик/чип) — для подсветки на карте и деталей в мобильной версии.
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    loadTranslations();
  }, [language]);

  useEffect(() => {
    // Зоны + координаты ресторана.
    fetch('/api/delivery/check-zone')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setZones(data.zones || []);
          const loc = data.restaurantLocation;
          if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            setRestaurantCoords({ lat: loc.lat, lng: loc.lng });
          }
        }
      })
      .catch((error) => console.error('Error loading delivery zones:', error));
  }, []);

  const sortedZones = sortZonesForList(zones as any[]);

  // По умолчанию выбираем ближайшую (наименьшую) зону.
  useEffect(() => {
    if (!selectedZoneId && sortedZones.length > 0) {
      setSelectedZoneId(sortedZones[0]._id);
    }
  }, [sortedZones, selectedZoneId]);

  const selectedZone = sortedZones.find((z: any) => z._id === selectedZoneId) || null;
  // На карте подсвечиваем наведённую (desktop) или выбранную зону.
  const activeZoneId = hoveredZoneId ?? selectedZoneId;

  // Немецкий формат суммы: «20,00 €».
  const eur = (v: number) =>
    `${Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  // Метрики зоны: каждая в своей строке (label слева, сумма справа). Сумма —
  // whitespace-nowrap, чтобы «€» не отрывался; label — min-w-0 truncate, чтобы
  // в узкой панели ничего не наезжало.
  const renderMetrics = (zone: any) => (
    <div data-testid="delivery-zone-metrics" className="grid grid-cols-1 gap-1.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-600 min-w-0 truncate">
          {t('delivery_page.min_order', 'Mindestbestellwert')}
        </span>
        <span className="font-semibold whitespace-nowrap">{eur(zone.minOrderAmount)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-600 min-w-0 truncate">
          {t('delivery_page.fee', 'Lieferkosten')}
        </span>
        {zone.deliveryFee > 0 ? (
          <span className="font-semibold whitespace-nowrap">{eur(zone.deliveryFee)}</span>
        ) : (
          <span className="font-semibold whitespace-nowrap text-green-600">
            {t('delivery_page.free', 'Kostenlos')}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-testid="delivery-page-container"
      className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 overflow-x-hidden"
    >
      <h1 className="text-3xl sm:text-4xl font-bold mb-8">{t('delivery_page.title', 'Liefergebiete')}</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Карта */}
        <div className="lg:col-span-2 min-w-0">
          <div
            data-testid="delivery-zones-map"
            className="w-full max-w-full overflow-hidden rounded-2xl"
          >
            <DeliveryZoneMap
              restaurantCoords={restaurantCoords}
              zones={(zones as any[]).map((z) => ({ id: z._id, name: z.name, maxDistance: z.maxDistance }))}
              highlightedZoneId={activeZoneId}
              className="h-[360px] sm:h-[460px] w-full max-w-full"
            />
          </div>

          {/* Мобайл: горизонтальные чипы зон (как в Mama Mia) + детали выбранной зоны */}
          <div className="lg:hidden mt-3">
            {/* Обёртка overflow-hidden гасит bleed (-mx-4), чтобы ряд не расширял страницу */}
            <div className="relative w-full overflow-hidden">
              <div
                data-testid="delivery-zone-tabs"
                aria-label="Liefergebiete"
                className="flex gap-2 overflow-x-auto overscroll-x-contain scroll-smooth px-4 -mx-4 pb-2 [-webkit-overflow-scrolling:touch]"
              >
                {sortedZones.map((zone: any) => (
                  <button
                    key={zone._id}
                    type="button"
                    onClick={() => setSelectedZoneId(zone._id)}
                    className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                      selectedZoneId === zone._id
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    {zone.name}
                  </button>
                ))}
              </div>
            </div>

            {selectedZone && (
              <div
                data-testid="delivery-zone-card"
                className="mt-3 bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              >
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold">{selectedZone.name}</h2>
                  <span className="text-sm text-gray-500">
                    {t('delivery_page.up_to', 'bis')} {selectedZone.maxDistance} {t('delivery_check.km', 'km')}
                  </span>
                </div>
                {renderMetrics(selectedZone)}
              </div>
            )}
          </div>
        </div>

        {/* Desktop: вертикальный список зон (наведение/клик подсвечивает зону) */}
        <div className="hidden lg:block space-y-3">
          {sortedZones.map((zone: any) => (
            <button
              key={zone._id}
              type="button"
              data-testid="delivery-zone-card"
              onMouseEnter={() => setHoveredZoneId(zone._id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              onClick={() => setSelectedZoneId(zone._id)}
              className={`w-full text-left bg-white rounded-xl p-4 shadow-sm border transition-colors ${
                activeZoneId === zone._id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold">{zone.name}</h2>
                <span className="text-sm text-gray-500">
                  {t('delivery_page.up_to', 'bis')} {zone.maxDistance} {t('delivery_check.km', 'km')}
                </span>
              </div>
              {renderMetrics(zone)}
            </button>
          ))}
          {sortedZones.length === 0 && (
            <div className="bg-white rounded-xl p-6 text-center text-gray-400 border border-gray-100">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 bg-primary-50 rounded-2xl p-8">
        <h2 className="text-2xl font-bold mb-4">{t('delivery_page.time_title', 'Lieferzeit')}</h2>
        <p className="text-base sm:text-lg text-gray-700 mb-1">
          {t('delivery_page.time_avg', 'Durchschnittliche Lieferzeit')}:{' '}
          <strong>30–45 {t('hero.minutes', 'Minuten')}</strong>
        </p>
        <p className="text-sm sm:text-base text-gray-600">
          {t('delivery_page.peak_time_note', 'Zu Stoßzeiten bis zu')}{' '}
          <strong>90–100 {t('hero.minutes', 'Minuten')}</strong>
        </p>
      </div>
    </div>
  );
}
