/**
 * A stand-in for the parts of @rnmapbox/maps the sights layer uses: plain
 * views that record what each source and layer was handed, in drawing order.
 * The native map cannot draw under Jest; what matters here is what the layer
 * asks of it and how it answers a tap.
 *
 *   jest.mock('@rnmapbox/maps', () => require('./mapboxLayers').mapboxLayersModule);
 *   beforeEach(() => mapboxLayers.reset());
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

export interface SourceRecord {
  readonly id: string;
  readonly shape: unknown;
  readonly hitbox?: unknown;
  readonly onPress?: (event: unknown) => void;
}

export interface LayerRecord {
  readonly kind: 'circle' | 'line' | 'symbol';
  readonly id: string;
  readonly style: unknown;
  readonly filter?: unknown;
}

interface State {
  sources: Record<string, SourceRecord>;
  layers: Record<string, LayerRecord>;
  /** Source and layer ids in the order they were last drawn. */
  order: string[];
}

export const mapboxLayers: State & { reset(): void } = {
  sources: {},
  layers: {},
  order: [],
  reset() {
    this.sources = {};
    this.layers = {};
    this.order = [];
  },
};

function ShapeSource(props: SourceRecord & { children?: ReactNode }) {
  const { children, ...record } = props;
  mapboxLayers.sources[record.id] = record;
  mapboxLayers.order.push(record.id);
  return <View testID={`source.${record.id}`}>{children}</View>;
}

function layer(kind: LayerRecord['kind']) {
  return function Layer(props: { id: string; style: unknown; filter?: unknown }) {
    mapboxLayers.layers[props.id] = { kind, ...props };
    mapboxLayers.order.push(props.id);
    return null;
  };
}

function MarkerView(props: { coordinate: [number, number]; anchor?: unknown; allowOverlap?: boolean; children: ReactNode }) {
  const { children, ...rest } = props;
  return (
    <View testID="markerView" {...{ markerProps: rest }}>
      {children}
    </View>
  );
}

export const mapboxLayersModule = {
  __esModule: true,
  default: { setAccessToken: () => Promise.resolve(null), setTelemetryEnabled: () => undefined },
  ShapeSource,
  CircleLayer: layer('circle'),
  LineLayer: layer('line'),
  SymbolLayer: layer('symbol'),
  MarkerView,
};
