'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type Track = {
  cameraId: string;
  trackId: string;
  objectClass: 'person' | 'vehicle' | 'animal' | 'other';
  confidence: number;
  timestamp: string;
  position: { lat: number; lon: number };
  heading?: number;
  zoneId?: string;
  clipUrl?: string;
};

type TrackResponse = {
  tracks?: Track[];
  configured?: boolean;
  generatedAt?: string;
  maxAgeSeconds?: number;
  error?: string;
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ageSeconds(timestamp: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
}

export default function PalantirCameraTrackingMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [selectedClass, setSelectedClass] = useState<'all' | Track['objectClass']>('all');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/palantir/camera-tracks', { cache: 'no-store' });
      const body = await response.json() as TrackResponse;
      setConfigured(body.configured ?? null);
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setTracks(Array.isArray(body.tracks) ? body.tracks : []);
      setGeneratedAt(body.generatedAt || new Date().toISOString());
      setStatus('live');
      setError('');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unable to load camera tracks.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-77.04, 38.91],
      zoom: 10,
      minZoom: 1.5,
      maxZoom: 19,
      attributionControl: false,
      transformRequest: (url: string) => {
        if (url.includes('cartocdn.com')) {
          return { url: `/api/proxy-tiles?url=${encodeURIComponent(url)}` };
        }
        return { url };
      },
    });

    map.on('load', () => {
      map.addSource('palantir-camera-tracks', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'palantir-track-glow',
        type: 'circle',
        source: 'palantir-camera-tracks',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 12, 15, 18, 24],
          'circle-color': ['match', ['get', 'objectClass'], 'person', '#D4AF37', 'vehicle', '#00E5FF', 'animal', '#76FF03', '#B388FF'],
          'circle-opacity': 0.18,
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'palantir-track-dot',
        type: 'circle',
        source: 'palantir-camera-tracks',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 6, 18, 10],
          'circle-color': ['match', ['get', 'objectClass'], 'person', '#D4AF37', 'vehicle', '#00E5FF', 'animal', '#76FF03', '#B388FF'],
          'circle-opacity': 0.92,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#05060A',
        },
      });
      map.addLayer({
        id: 'palantir-track-label',
        type: 'symbol',
        source: 'palantir-camera-tracks',
        minzoom: 13,
        layout: {
          'text-field': ['concat', ['upcase', ['get', 'objectClass']], '  ', ['get', 'trackId']],
          'text-size': 9,
          'text-font': ['Open Sans Regular'],
          'text-offset': [0, 1.4],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#E8E6E0',
          'text-halo-color': '#05060A',
          'text-halo-width': 1.5,
        },
      });

      map.on('click', 'palantir-track-dot', (event) => {
        if (!event.features?.length) return;
        const feature = event.features[0];
        const p = feature.properties as Record<string, string>;
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const clip = p.clipUrl
          ? `<a href="${escapeHtml(p.clipUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:9px;color:#00E5FF;text-decoration:none;border:1px solid rgba(0,229,255,.35);padding:5px 8px;border-radius:4px">AUTHORIZED CLIP ↗</a>`
          : '';
        new maplibregl.Popup({ offset: 12, maxWidth: '360px' })
          .setLngLat(coords)
          .setHTML(`<div style="background:#0B0D13;color:#E8E6E0;font:11px 'JetBrains Mono',monospace;padding:12px;border:1px solid rgba(212,175,55,.25)">
            <div style="color:#D4AF37;font-weight:700;letter-spacing:.12em;margin-bottom:8px">PALANTIR CAMERA TRACK</div>
            <div>TRACK: ${escapeHtml(p.trackId)}</div>
            <div>CAMERA: ${escapeHtml(p.cameraId)}</div>
            <div>CLASS: ${escapeHtml(p.objectClass).toUpperCase()}</div>
            <div>CONF: ${(Number(p.confidence || 0) * 100).toFixed(1)}%</div>
            <div>ZONE: ${escapeHtml(p.zoneId || '—')}</div>
            <div>AGE: ${ageSeconds(p.timestamp || '')}s</div>${clip}
          </div>`)
          .addTo(map);
      });
      map.on('mouseenter', 'palantir-track-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'palantir-track-dot', () => { map.getCanvas().style.cursor = ''; });
      setMapReady(true);
      mapRef.current = map;
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const visibleTracks = useMemo(
    () => selectedClass === 'all' ? tracks : tracks.filter(track => track.objectClass === selectedClass),
    [tracks, selectedClass],
  );

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource('palantir-camera-tracks') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: visibleTracks.map(track => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [track.position.lon, track.position.lat] },
        properties: {
          trackId: track.trackId,
          cameraId: track.cameraId,
          objectClass: track.objectClass,
          confidence: track.confidence,
          timestamp: track.timestamp,
          zoneId: track.zoneId || '',
          clipUrl: track.clipUrl || '',
          heading: track.heading ?? 0,
        },
      })),
    });
  }, [mapReady, visibleTracks]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || visibleTracks.length === 0) return;
    if (visibleTracks.length === 1) {
      const track = visibleTracks[0];
      mapRef.current.easeTo({ center: [track.position.lon, track.position.lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 900 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    visibleTracks.forEach(track => bounds.extend([track.position.lon, track.position.lat]));
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, { padding: 90, maxZoom: 15, duration: 900 });
  }, [mapReady, visibleTracks.length]);

  const counts = useMemo(() => {
    const result = { person: 0, vehicle: 0, animal: 0, other: 0 };
    tracks.forEach(track => { result[track.objectClass] += 1; });
    return result;
  }, [tracks]);

  return (
    <main style={{ height: '100dvh', width: '100%', background: '#05060A', color: '#E8E6E0', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <section style={{ position: 'absolute', zIndex: 10, left: 18, top: 18, width: 'min(430px, calc(100vw - 36px))', background: 'rgba(5,6,10,.90)', border: '1px solid rgba(212,175,55,.22)', backdropFilter: 'blur(18px)', padding: 16, fontFamily: "'JetBrains Mono', monospace" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 800, letterSpacing: '.16em', fontSize: 12 }}>PALANTIR CAMERA TRACKING</div>
            <div style={{ color: 'rgba(232,230,224,.45)', fontSize: 9, marginTop: 4 }}>DE-IDENTIFIED LIVE OBJECT ANALYTICS</div>
          </div>
          <div style={{ fontSize: 9, color: status === 'live' ? '#76FF03' : status === 'error' ? '#FF5252' : '#FFD54F' }}>
            ● {status.toUpperCase()}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 14 }}>
          {(['person', 'vehicle', 'animal', 'other'] as const).map(key => (
            <button key={key} onClick={() => setSelectedClass(selectedClass === key ? 'all' : key)} style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 7px', background: selectedClass === key ? 'rgba(212,175,55,.12)' : 'rgba(255,255,255,.03)', border: selectedClass === key ? '1px solid rgba(212,175,55,.35)' : '1px solid rgba(255,255,255,.06)', color: '#E8E6E0', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{counts[key]}</div>
              <div style={{ fontSize: 7, opacity: .48, textTransform: 'uppercase', letterSpacing: '.08em' }}>{key}</div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'rgba(232,230,224,.45)' }}>
          <span>{visibleTracks.length} VISIBLE / {tracks.length} ACTIVE</span>
          <span>{generatedAt ? new Date(generatedAt).toLocaleTimeString() : '—'}</span>
        </div>

        {configured === false && <div style={{ marginTop: 10, color: '#FFD54F', fontSize: 9 }}>Set PALANTIR_HOSTNAME, PALANTIR_TOKEN and PALANTIR_ONTOLOGY on the server.</div>}
        {error && <div style={{ marginTop: 10, color: '#FF8A80', fontSize: 9 }}>{error}</div>}

        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.06)', color: 'rgba(232,230,224,.38)', fontSize: 8, lineHeight: 1.5 }}>
          Anonymous per-camera tracks only. No face recognition, biometric templates, or cross-camera identity matching in this surface.
        </div>
      </section>
    </main>
  );
}
