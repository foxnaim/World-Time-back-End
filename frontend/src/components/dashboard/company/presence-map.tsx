'use client';

import * as React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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

export type PresenceMarker = {
  employeeId: string;
  name: string;
  lat: number;
  lng: number;
};

export type PresenceMapProps = {
  /** People currently in office that have coordinates. */
  markers: PresenceMarker[];
  /** Company location to center on; falls back to the marker average. */
  center?: { lat: number; lng: number } | null;
  className?: string;
};

// Almaty — same placeholder used elsewhere in the app.
const DEFAULT_CENTER: [number, number] = [43.238949, 76.889709];

export default function PresenceMap({ markers, center, className }: PresenceMapProps) {
  const resolvedCenter: [number, number] = React.useMemo(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
      return [center.lat, center.lng];
    }
    if (markers.length > 0) {
      const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
      const lng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
      return [lat, lng];
    }
    return DEFAULT_CENTER;
  }, [center, markers]);

  return (
    <div
      className={
        'overflow-hidden rounded-2xl border border-[#8E8D8A]/30 ' + (className ?? '')
      }
    >
      <MapContainer
        center={resolvedCenter}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: 280, width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markers.map((m) => (
          <Marker key={m.employeeId} position={[m.lat, m.lng]} icon={DEFAULT_ICON}>
            <Popup>{m.name}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
