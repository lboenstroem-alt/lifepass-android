/**
 * A stand-in for expo-camera in the meal page's tests: the CameraView opens
 * at once (`onCameraReady`), takes a "picture ref" when asked, and hands the
 * test whatever barcode it is shown; the permission hook reads what the
 * test set. Required from `jest.mock` factories, so it loads nothing of the
 * app.
 */
import type { PermissionResponse } from 'expo-camera';
import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

export const GRANTED: PermissionResponse = { status: 'granted' as never, granted: true, canAskAgain: true, expires: 'never' };
export const DENIED: PermissionResponse = { status: 'denied' as never, granted: false, canAskAgain: false, expires: 'never' };

interface CameraProps {
  readonly testID?: string;
  readonly enableTorch?: boolean;
  readonly barcodeScannerSettings?: { readonly barcodeTypes: readonly string[] };
  readonly onCameraReady?: () => void;
  readonly onBarcodeScanned?: (scan: { type: string; data: string }) => void;
  readonly children?: ReactNode;
}

export interface FakePictureRef {
  readonly width: number;
  readonly height: number;
  released: boolean;
  release(): void;
}

export const cameraDouble = {
  permission: GRANTED as PermissionResponse | null,
  /** Options of every takePictureAsync. */
  shots: [] as Record<string, unknown>[],
  pictures: [] as FakePictureRef[],
  /** The props the mounted camera last rendered with (null when none is mounted). */
  props: null as CameraProps | null,
  mounts: 0,
  reset(permission: PermissionResponse | null = GRANTED): void {
    this.permission = permission;
    this.shots = [];
    this.pictures = [];
    this.props = null;
    this.mounts = 0;
  },
  /** One frame with `data` in view. */
  showBarcode(type: string, data: string): void {
    this.props?.onBarcodeScanned?.({ type, data });
  },
};

const CameraView = forwardRef<object, CameraProps>(function CameraView(props, ref) {
  useImperativeHandle(ref, () => ({
    takePictureAsync: async (options: Record<string, unknown>) => {
      cameraDouble.shots.push(options);
      const picture: FakePictureRef = {
        width: 3024,
        height: 4032,
        released: false,
        release() {
          picture.released = true;
        },
      };
      cameraDouble.pictures.push(picture);
      return picture;
    },
  }));
  cameraDouble.props = props;
  useEffect(() => {
    cameraDouble.mounts += 1;
    props.onCameraReady?.();
    return () => {
      cameraDouble.props = null;
    };
    // Once per mount, as CameraX opens the camera once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View testID={props.testID} />;
});

async function readPermission(): Promise<PermissionResponse | null> {
  return cameraDouble.permission;
}

export const expoCameraModule = {
  CameraView,
  useCameraPermissions: () => [cameraDouble.permission, readPermission, readPermission] as const,
};
