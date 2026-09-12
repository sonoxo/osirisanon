import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_OBJECT_CLASSES = new Set(['person', 'vehicle', 'animal', 'other']);
const MAX_PAGE_SIZE = 1000;

type CameraTrack = {
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

function readString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readTimestamp(value: unknown): string | undefined {
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function readHttpsUrl(value: unknown): string | undefined {
  const raw = readString(value, 2048);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTrack(row: Record<string, unknown>): CameraTrack | null {
  const cameraId = readString(row.cameraId, 128);
  const trackId = readString(row.trackId ?? row.__primaryKey, 128);
  const latitude = readNumber(row.latitude ?? row.lat);
  const longitude = readNumber(row.longitude ?? row.lng ?? row.lon);
  const timestamp = readTimestamp(row.timestamp);

  if (!cameraId || !trackId || latitude === undefined || longitude === undefined || !timestamp) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const rawClass = (readString(row.objectClass, 32) || 'other').toLowerCase();
  const objectClass = ALLOWED_OBJECT_CLASSES.has(rawClass)
    ? rawClass as CameraTrack['objectClass']
    : 'other';

  const confidenceRaw = readNumber(row.confidence) ?? 0;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));
  const headingRaw = readNumber(row.heading);
  const heading = headingRaw === undefined ? undefined : ((headingRaw % 360) + 360) % 360;

  return {
    cameraId,
    trackId,
    objectClass,
    confidence,
    timestamp,
    position: { lat: latitude, lon: longitude },
    ...(heading === undefined ? {} : { heading }),
    ...(readString(row.zoneId, 128) ? { zoneId: readString(row.zoneId, 128) } : {}),
    ...(readHttpsUrl(row.clipUrl) ? { clipUrl: readHttpsUrl(row.clipUrl) } : {}),
  };
}

export async function GET() {
  const hostnameRaw = process.env.PALANTIR_HOSTNAME;
  const token = process.env.PALANTIR_TOKEN;
  const ontology = process.env.PALANTIR_ONTOLOGY;
  const objectType = process.env.PALANTIR_CAMERA_TRACK_OBJECT_TYPE || 'cameraTrack';
  const maxAgeSeconds = Math.max(5, Math.min(3600, Number(process.env.PALANTIR_CAMERA_TRACK_MAX_AGE_SECONDS || 90)));

  if (!hostnameRaw || !token || !ontology) {
    return NextResponse.json(
      {
        tracks: [],
        configured: false,
        error: 'Palantir camera tracking is not configured on this server.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const hostname = /^https?:\/\//i.test(hostnameRaw) ? hostnameRaw : `https://${hostnameRaw}`;
    const url = new URL(
      `/api/v2/ontologies/${encodeURIComponent(ontology)}/objects/${encodeURIComponent(objectType)}`,
      hostname,
    );
    url.searchParams.set('pageSize', String(MAX_PAGE_SIZE));
    url.searchParams.set('orderBy', 'properties.timestamp:desc');
    url.searchParams.set('excludeRid', 'true');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          tracks: [],
          configured: true,
          error: `Palantir Ontology request failed with status ${response.status}.`,
        },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const payload = await response.json() as { data?: unknown[]; totalCount?: string };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const now = Date.now();
    const oldestAllowed = now - maxAgeSeconds * 1000;
    const newestAllowed = now + 60_000;

    const tracks = rows
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
      .map(normalizeTrack)
      .filter((track): track is CameraTrack => !!track)
      .filter(track => {
        const timestamp = Date.parse(track.timestamp);
        return timestamp >= oldestAllowed && timestamp <= newestAllowed;
      });

    return NextResponse.json(
      {
        tracks,
        configured: true,
        generatedAt: new Date(now).toISOString(),
        maxAgeSeconds,
        sourceCount: rows.length,
        totalCount: payload.totalCount,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('[OSIRIS] Palantir camera tracking fetch failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        tracks: [],
        configured: true,
        error: 'Unable to reach the configured Palantir camera-track source.',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
