"use client";

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_DETOUR_FACTOR, zoneMapRadiusKm } from '../../lib/delivery/detour';

export interface MapZone {
  id: string;
  name: string;
  maxDistance: number;
}

export interface DeliveryZoneMapProps {
  restaurantCoords: { lat: number; lng: number };
  zones: MapZone[];
  addressMarker?: { lat: number; lng: number } | null;
  highlightedZoneId?: string | null;
  /** Наведение на круг зоны на карте (для двунаправленной подсветки в админке). */
  onZoneHover?: (zoneId: string | null) => void;
  /**
   * Коэффициент объезда: maxDistance зон — километры ПО ДОРОГЕ, а круг рисуется
   * по прямой. Радиус делим на него, иначе карта обещает область заметно больше
   * той, куда реально доезжает курьер.
   */
  detourFactor?: number;
  className?: string;
}

// divIcon, чтобы не зависеть от leaflet-ассетов маркеров (ломаются в бандлере).
const pin = (color: string) =>
  L.divIcon({
    className: 'dz-pin',
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });

function FitBounds({
  restaurantCoords,
  addressMarker,
  maxRadiusKm,
}: {
  restaurantCoords: { lat: number; lng: number };
  addressMarker?: { lat: number; lng: number } | null;
  maxRadiusKm: number;
}) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      // Карта грузится динамически внутри grid/flex-колонки: на момент mount её
      // контейнер часто ещё 0×0, и fitBounds считает зум для пустого вьюпорта —
      // отсюда карта мира вместо Bad Kissingen. invalidateSize даёт Leaflet
      // актуальный размер ПЕРЕД расчётом.
      map.invalidateSize({ animate: false });
      const r = L.latLng(restaurantCoords.lat, restaurantCoords.lng);
      if (addressMarker) {
        // Показать ресторан и адрес одновременно.
        const bounds = L.latLngBounds([r, L.latLng(addressMarker.lat, addressMarker.lng)]);
        map.fitBounds(bounds.pad(0.4), { animate: false });
      } else {
        // Иначе вписать самый большой круг зоны. toBounds() считает рамку из точки+метров
        // без привязки к карте (у detached L.circle.getBounds() нет _map → падает).
        const meters = Math.max(maxRadiusKm, 0.5) * 1000;
        map.fitBounds(r.toBounds(meters * 2).pad(0.1), { animate: false });
      }
    };

    fit();
    // Второй проход после первого кадра: к этому моменту контейнер уже разложен.
    // (ResizeObserver здесь не годится — invalidateSize внутри его коллбэка
    //  сам провоцирует resize-цикл и подвешивает вкладку.)
    const raf = requestAnimationFrame(fit);
    const timer = setTimeout(fit, 250);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [map, restaurantCoords.lat, restaurantCoords.lng, addressMarker, maxRadiusKm]);
  return null;
}

export default function DeliveryZoneMap({
  restaurantCoords,
  zones,
  addressMarker,
  highlightedZoneId,
  onZoneHover,
  detourFactor = DEFAULT_DETOUR_FACTOR,
  className,
}: DeliveryZoneMapProps) {
  // Сначала большие круги, потом меньшие — мелкие зоны видны поверх.
  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => (b.maxDistance || 0) - (a.maxDistance || 0)),
    [zones]
  );
  const maxRadiusKm = useMemo(
    () => Math.max(0.5, ...zones.map((z) => zoneMapRadiusKm(z.maxDistance || 0, detourFactor))),
    [zones, detourFactor]
  );

  return (
    <MapContainer
      center={[restaurantCoords.lat, restaurantCoords.lng]}
      zoom={13}
      scrollWheelZoom={false}
      // isolate + z-0 + overflow-hidden: внутренние z-index Leaflet (контролы ~1000)
      // не должны вылезать поверх хедера — держим карту в своём стек-контексте.
      className={`relative z-0 isolate overflow-hidden ${className || 'h-[420px] w-full rounded-lg'}`}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {sortedZones.map((zone) => {
        const isHighlighted = highlightedZoneId === zone.id;
        return (
          <Circle
            key={zone.id}
            center={[restaurantCoords.lat, restaurantCoords.lng]}
            radius={zoneMapRadiusKm(zone.maxDistance || 0, detourFactor) * 1000}
            pathOptions={{
              color: isHighlighted ? '#dc2626' : '#3b82f6',
              weight: isHighlighted ? 3 : 1,
              fillColor: isHighlighted ? '#ef4444' : '#3b82f6',
              fillOpacity: isHighlighted ? 0.18 : 0.05,
            }}
            eventHandlers={
              onZoneHover
                ? {
                    mouseover: () => onZoneHover(zone.id),
                    mouseout: () => onZoneHover(null),
                  }
                : undefined
            }
          >
            <Tooltip>{zone.name} — bis {zone.maxDistance} km Fahrstrecke</Tooltip>
          </Circle>
        );
      })}

      <Marker position={[restaurantCoords.lat, restaurantCoords.lng]} icon={pin('#16a34a')}>
        <Popup>Restaurant</Popup>
      </Marker>

      {addressMarker && (
        <Marker position={[addressMarker.lat, addressMarker.lng]} icon={pin('#dc2626')}>
          <Popup>Adresse</Popup>
        </Marker>
      )}

      <FitBounds
        restaurantCoords={restaurantCoords}
        addressMarker={addressMarker}
        maxRadiusKm={maxRadiusKm}
      />
    </MapContainer>
  );
}
