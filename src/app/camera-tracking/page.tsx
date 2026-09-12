import PalantirCameraTrackingMap from '@/components/PalantirCameraTrackingMap';

export const metadata = {
  title: 'Palantir Camera Tracking | OSIRIS',
  description: 'Authorized, de-identified live camera analytics mapped through the Palantir Ontology.',
};

export default function CameraTrackingPage() {
  return <PalantirCameraTrackingMap />;
}
