'use client';

import * as React from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ---------------------------------------------------------------------------
// Leaflet's default marker icon ships as relative PNGs that Webpack/Next mangle,
// and loading them from a CDN trips the app's CSP. Use a self-contained CSS pin
// (a coral teardrop) via L.divIcon — no external requests.
// ---------------------------------------------------------------------------
const DEFAULT_ICON = L.divIcon({
  className: 'wt-map-pin',
  html:
    '<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;' +
    'background:#E85A4F;border:2px solid #EAE7DC;transform:rotate(-45deg);' +
    'box-shadow:0 1px 4px rgba(0,0,0,.3)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
  popupAnchor: [0, -16],
});

export type LatLng = { lat: number; lng: number };

export type GeofenceMapLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

export type GeofenceMapProps = {
  /** Current marker position. When null the map centers on a sensible default. */
  value: LatLng | null;
  /** Geofence radius in metres for the editable circle. */
  radiusM: number;
  /** Called when the user clicks the map or drags the marker. */
  onChange: (next: LatLng) => void;
  /** Read-only circles for the company's other saved locations. */
  locations?: GeofenceMapLocation[];
  className?: string;
};

// Almaty — matches the placeholder coords used elsewhere in settings.
const DEFAULT_CENTER: [number, number] = [43.238949, 76.889709];

/**
 * Leaflet computes its tile coverage from the container size at init. When the
 * map mounts before its flex/grid parent has settled (common with next/dynamic
 * + ssr:false), it ends up rendering a tiny square. Force a recalc after mount
 * and whenever the container resizes.
 */
function SizeFix() {
  const map = useMap();
  React.useEffect(() => {
    const el = map.getContainer();
    const fix = () => map.invalidateSize();
    // a couple of rAF ticks covers the post-mount layout pass
    requestAnimationFrame(() => requestAnimationFrame(fix));
    const ro = new ResizeObserver(fix);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Captures map clicks and forwards them as a new marker position. */
function ClickCapture({ onChange }: { onChange: (next: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * Recenters the map when the marker moves *externally* (e.g. the user typed
 * into the lat/lng inputs). We deliberately skip recentring on map-originated
 * changes so dragging/clicking doesn't fight the user.
 */
function Recenter({ value }: { value: LatLng | null }) {
  const map = useMap();
  const lastRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!value) return;
    const key = `${value.lat.toFixed(6)},${value.lng.toFixed(6)}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    map.setView([value.lat, value.lng], map.getZoom(), { animate: true });
  }, [value, map]);
  return null;
}

export default function GeofenceMap({
  value,
  radiusM,
  onChange,
  locations = [],
  className,
}: GeofenceMapProps) {
  const markerRef = React.useRef<L.Marker | null>(null);

  const center: [number, number] = value
    ? [value.lat, value.lng]
    : DEFAULT_CENTER;

  const handleDragEnd = React.useCallback(() => {
    const m = markerRef.current;
    if (!m) return;
    const ll = m.getLatLng();
    onChange({ lat: ll.lat, lng: ll.lng });
  }, [onChange]);

  return (
    <div
      className={
        'overflow-hidden rounded-2xl border border-[#8E8D8A]/30 ' + (className ?? '')
      }
    >
      <MapContainer
        center={center}
        zoom={value ? 15 : 11}
        scrollWheelZoom
        attributionControl={false}
        style={{ height: 360, width: '100%' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <SizeFix />
        <ClickCapture onChange={onChange} />
        <Recenter value={value} />

        {/* Read-only circles for the company's other saved locations. */}
        {locations.map((loc) => (
          <Circle
            key={loc.id}
            center={[loc.latitude, loc.longitude]}
            radius={loc.geofenceRadiusM}
            pathOptions={{
              color: '#8E8D8A',
              weight: 1,
              fillColor: '#8E8D8A',
              fillOpacity: 0.08,
            }}
          />
        ))}

        {value && (
          <>
            <Circle
              center={[value.lat, value.lng]}
              radius={Math.max(1, radiusM)}
              pathOptions={{
                color: '#E85A4F',
                weight: 1.5,
                fillColor: '#E98074',
                fillOpacity: 0.15,
              }}
            />
            <Marker
              position={[value.lat, value.lng]}
              icon={DEFAULT_ICON}
              draggable
              eventHandlers={{ dragend: handleDragEnd }}
              ref={(instance) => {
                markerRef.current = instance;
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
