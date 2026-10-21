/**
 * A stand-in for @rnmapbox/maps in component tests: plain views that record
 * what the map was handed, and a map whose screen maths a test sets. The
 * native map cannot draw under Jest; what matters here is what ExploreMap
 * asks of it (pins, layers, camera moves) and how it answers its taps.
 *
 *   jest.mock('@rnmapbox/maps', () => require('./mapboxStandIn').mapboxModule);
 *   beforeEach(() => mapboxStandIn.reset());
 */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

type Position = [number, number];

interface StandInState {
  /** The props the MapView was last rendered with. */
  mapProps: Record<string, unknown> | null;
  /** The Camera's `defaultSettings`. */
  cameraDefaults: unknown;
  /** Every `setCamera` call. */
  setCamera: jest.Mock;
  /** Where a coordinate lands on screen ([x, y] in dp). */
  pointInView: (coordinate: Position) => Position;
  /** The camera's centre. */
  center: Position;
  /** Where a screen point is on the map. */
  coordinateFromView: (point: Position) => Position;
  /** The last ShapeSource's shape, by id. */
  shapes: Record<string, unknown>;
  /** The last SymbolLayer style, by id. */
  symbolStyles: Record<string, unknown>;
  setTelemetryEnabled: jest.Mock;
  setAccessToken: jest.Mock;
}

function freshState(): StandInState {
  return {
    mapProps: null,
    cameraDefaults: null,
    setCamera: jest.fn(),
    pointInView: () => [0, 0],
    center: [-21.9426, 64.1466],
    coordinateFromView: ([x, y]) => [x, y],
    shapes: {},
    symbolStyles: {},
    setTelemetryEnabled: jest.fn(),
    setAccessToken: jest.fn(() => Promise.resolve(null)),
  };
}

export const mapboxStandIn: StandInState & { reset(): void } = Object.assign(freshState(), {
  reset() {
    const fresh = freshState();
    // The module's own setup calls live on the module object; keep them.
    const { setTelemetryEnabled, setAccessToken } = mapboxStandIn;
    Object.assign(mapboxStandIn, fresh, { setTelemetryEnabled, setAccessToken });
  },
});

const MapView = forwardRef(function MapView(props: Record<string, unknown> & { children?: ReactNode }, ref) {
  mapboxStandIn.mapProps = props;
  useImperativeHandle(ref, () => ({
    getPointInView: async (coordinate: Position) => mapboxStandIn.pointInView(coordinate),
    getCenter: async () => mapboxStandIn.center,
    getCoordinateFromView: async (point: Position) => mapboxStandIn.coordinateFromView(point),
  }));
  return <View testID={props.testID as string}>{props.children}</View>;
});

const Camera = forwardRef(function Camera(props: { defaultSettings?: unknown }, ref) {
  mapboxStandIn.cameraDefaults = props.defaultSettings;
  useImperativeHandle(ref, () => ({ setCamera: (config: unknown) => mapboxStandIn.setCamera(config) }));
  return null;
});

/** A marker: its props are kept on the view, so a test reads them in drawing order (`getAllByTestId('markerView')`). */
function MarkerView(props: {
  coordinate: Position;
  anchor?: unknown;
  isSelected?: boolean;
  allowOverlap?: boolean;
  allowOverlapWithPuck?: boolean;
  children: ReactNode;
}) {
  const { children, ...rest } = props;
  return (
    <View testID="markerView" {...{ markerProps: rest }}>
      {children}
    </View>
  );
}

function LocationPuck() {
  return <View testID="locationPuck" />;
}

function ShapeSource(props: { id: string; shape: unknown; children?: ReactNode }) {
  mapboxStandIn.shapes[props.id] = props.shape;
  return <View testID={`shapeSource.${props.id}`}>{props.children}</View>;
}

function SymbolLayer(props: { id: string; style: unknown }) {
  mapboxStandIn.symbolStyles[props.id] = props.style;
  return null;
}

export const mapboxModule = {
  __esModule: true,
  default: {
    setTelemetryEnabled: (...args: unknown[]) => mapboxStandIn.setTelemetryEnabled(...args),
    setAccessToken: (...args: unknown[]) => mapboxStandIn.setAccessToken(...args),
  },
  MapView,
  Camera,
  MarkerView,
  LocationPuck,
  ShapeSource,
  SymbolLayer,
};
