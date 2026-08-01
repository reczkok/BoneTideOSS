import './src/platform/polyfills.ts';
import 'react-native-webgpu';
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import tgpu, { type TgpuRoot } from 'typegpu';
import { Root } from '@typegpu/react';
import { GameScreen } from './components/GameScreen.tsx';
import { colors, font } from './src/ui/theme.ts';

type DawnDeviceDescriptor = GPUDeviceDescriptor & {
  optionalFeatures?: Iterable<GPUFeatureName>;
};

export default function App() {
  const [root, setRoot] = useState<TgpuRoot | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    tgpu
      .init({
        device: {
          optionalFeatures: ['implicit-device-synchronization' as GPUFeatureName],
        } satisfies DawnDeviceDescriptor as GPUDeviceDescriptor,
      })
      .then(
        (created) => {
          if (!disposed) setRoot(created);
        },
        (err: unknown) => {
          if (!disposed) setInitError(err instanceof Error ? err.message : String(err));
        },
      );
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.fill}>
          <StatusBar hidden />
          {root && (
            <Root root={root}>
              <GameScreen />
            </Root>
          )}
          {initError !== null && (
            <View style={styles.fatal}>
              <Text style={styles.fatalTitle}>WebGPU unavailable</Text>
              <Text style={styles.fatalNote}>{initError}</Text>
            </View>
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ink },
  fatal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fatalTitle: {
    color: colors.bone,
    fontFamily: font.serif,
    fontSize: 24,
    letterSpacing: 4,
    marginBottom: 16,
  },
  fatalNote: {
    color: colors.boneDim,
    fontFamily: font.serif,
    fontSize: 14,
    paddingHorizontal: 40,
    textAlign: 'center',
  },
});
