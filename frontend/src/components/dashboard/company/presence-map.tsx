'use client';

import * as React from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Force Leaflet to recompute tile coverage after the container settles. */
function SizeFix() {
  const map = useMap();
  React.useEffect(() => {
    const el = map.getContainer();
    const fix = () => map.invalidateSize();
    requestAnimationFrame(() => requestAnimationFrame(fix));
    const ro = new ResizeObserver(fix);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// ---------------------------------------------------------------------------
// Self-contained CSS pin (coral teardrop) via L.divIcon — avoids Leaflet's
// mangled relative PNGs and any CDN request that would trip the app's CSP.
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
        attributionControl={false}
        style={{ height: 280, width: '100%' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <SizeFix />
        {markers.map((m) => (
          <Marker key={m.employeeId} position={[m.lat, m.lng]} icon={DEFAULT_ICON}>
            <Popup>{m.name}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
