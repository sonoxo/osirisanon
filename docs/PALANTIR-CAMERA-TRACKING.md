# Palantir Camera Tracking for OSIRIS

This integration adds an authorized, de-identified camera-analytics surface to OSIRIS at `/camera-tracking`.

## Architecture

```text
AUTHORIZED CAMERAS / VMS
        |
        v
EDGE VIDEO ANALYTICS
(object detection + short-lived tracking)
        |
        v
FOUNDRY STREAMING INGEST
        |
        v
ONTOLOGY: CameraTrack
        |
        +----------------------+
        |                      |
        v                      v
OSIRIS API                 PALANTIR WORKFLOWS
/api/palantir/...          Automate / AIP / alerts
        |
        v
/camera-tracking
MapLibre live map
```

Keep raw video in the authorized camera/VMS or approved Palantir media storage path. OSIRIS should receive event metadata, not unrestricted raw camera credentials.

## `CameraTrack` object contract

The OSIRIS adapter expects an Ontology object type whose API name defaults to `cameraTrack`. Configure another API name with `PALANTIR_CAMERA_TRACK_OBJECT_TYPE`.

Expected properties:

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `cameraId` | string | yes | Authorized camera identifier |
| `trackId` | string | yes | Short-lived track identifier; unique within the tracking scope |
| `objectClass` | string | yes | `person`, `vehicle`, `animal`, or `other` |
| `confidence` | number | yes | 0.0–1.0 |
| `timestamp` | timestamp | yes | Observation time |
| `latitude` | number | yes | WGS84 |
| `longitude` | number | yes | WGS84 |
| `heading` | number | no | Degrees 0–359 |
| `zoneId` | string | no | Geofence/zone identifier |
| `clipUrl` | string | no | HTTPS URL to an access-controlled review clip |

The server adapter intentionally discards every property not on this allowlist.

## Foundry / Palantir setup

1. Connect an authorized camera/VMS or edge gateway to a Foundry streaming source. Prefer sending detection/tracking metadata rather than full-resolution continuous video when the workflow does not require video storage.
2. Run object detection and a short-lived tracker at the edge or in an approved compute environment. Emit one record per observation with the fields above.
3. Normalize the stream into a dataset with stable property types and timestamps.
4. Back an Ontology object type with the resulting data and set its API name to `cameraTrack`, or configure `PALANTIR_CAMERA_TRACK_OBJECT_TYPE` with your API name.
5. Grant the OSIRIS application/service identity read access only to the ontology/object type required by this view.
6. Configure the server environment variables below and deploy OSIRIS.
7. Open `/camera-tracking`. The browser polls the OSIRIS server every five seconds; Palantir credentials never reach the browser.

## Environment

```bash
PALANTIR_HOSTNAME=your-foundry-hostname
PALANTIR_TOKEN=server-side-token
PALANTIR_ONTOLOGY=your-ontology-api-name
PALANTIR_CAMERA_TRACK_OBJECT_TYPE=cameraTrack
PALANTIR_CAMERA_TRACK_MAX_AGE_SECONDS=90
```

`PALANTIR_TOKEN` must remain server-side. Never expose it through a `NEXT_PUBLIC_` variable.

## Event workflows

Useful Palantir Automate/AIP patterns can be driven from the same `CameraTrack` objects:

- zone entry / zone exit
- occupancy threshold exceeded
- vehicle present in a restricted parking zone
- object remains in a zone longer than an approved dwell-time threshold
- camera offline / stale event stream
- low model-confidence or sensor-quality alert

Keep automated actions reversible and route consequential responses through an authorized human reviewer.

## Privacy and authorization controls

This OSIRIS surface is intentionally limited to object-level analytics. Do not add face recognition, biometric templates, cross-camera person re-identification, inferred identity, or covert tracking of individuals.

Recommended production controls:

- use only owned or explicitly authorized camera sources
- scope Palantir permissions to the minimum object types and actions needed
- use short retention for track IDs and event metadata
- rotate track identifiers so they cannot become persistent identity keys
- keep access-controlled review clips separate from public map metadata
- retain audit logs for object reads and alert actions
- document the purpose and legal basis for each camera/zone
- require human review before high-impact operational action

## OSIRIS endpoints

- UI: `/camera-tracking`
- API: `/api/palantir/camera-tracks`

The API rejects malformed coordinates, filters stale observations, restricts object classes, and returns only the de-identified field allowlist used by the map.
