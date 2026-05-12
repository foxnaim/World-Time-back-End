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
// Fix the classic broken default-marker-icon issue (Webpack/Next mangles the
// relative image URLs Leaflet ships with). Point the default icon at the CDN.
// ---------------------------------------------------------------------------
const DEFAULT_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
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
        style={{ height: 360, width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

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
