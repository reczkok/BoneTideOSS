import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Touchable } from 'react-native-gesture-handler';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { useRoot } from '@typegpu/react';
import type { CanvasLike } from '@bonetide/engine/core/canvas.ts';
import type { AppState } from '@bonetide/engine/game/app.ts';
import type { Action } from '@bonetide/engine/game/input.ts';
import { createGameShell, type GameShell } from '../src/shell/createGameShell.ts';
import { createHudBridge } from '../src/ui/hudBridge.ts';
import { colors, font } from '../src/ui/theme.ts';
import { Hud } from './Hud.tsx';
import { Joystick } from './Joystick.tsx';

interface Fatal {
  title: string;
  detail: string;
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.buttons}>{children}</View>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Touchable style={styles.button} onPress={onPress} activeOpacity={0.6} animationDuration={0}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Touchable>
  );
}

export function GameScreen() {
  const root = useRoot();
  const canvasRef = useRef<CanvasRef>(null);
  const booting = useRef(false);
  const bridge = useMemo(() => createHudBridge(), []);
  const [shell, setShell] = useState<GameShell | null>(null);
  const [state, setState] = useState<AppState>('menu');
  const [progress, setProgress] = useState({ message: 'loading…', fraction: 0 });
  const [fatal, setFatal] = useState<Fatal | null>(null);

  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (shell) {
        shell.resize(width, height);
        return;
      }
      if (booting.current || !canvasRef.current) return;
      booting.current = true;
      let context: (GPUCanvasContext & { present?(): void }) | undefined;
      try {
        context = root.configureContext({
          canvas: canvasRef.current as unknown as HTMLCanvasElement,
        });
      } catch (err) {
        setFatal({
          title: 'WebGPU unavailable',
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const canvas = (context as unknown as { canvas?: CanvasLike }).canvas;
      if (!canvas) {
        setFatal({ title: 'WebGPU unavailable', detail: 'No native canvas on the GPU context.' });
        return;
      }
      createGameShell(root, context, canvas, {
        hud: bridge.hud,
        onProgress: (message, fraction) => setProgress({ message, fraction }),
        onState: setState,
        onFatal: (title, detail) => setFatal({ title, detail }),
      }).then(setShell, (err: unknown) => {
        setFatal({
          title: 'Failed to load',
          detail: err instanceof Error ? err.message : String(err),
        });
      });
    },
    [bridge, root, shell],
  );

  const press = useCallback((action: Action) => shell?.press(action), [shell]);
  const move = useCallback((x: number, z: number) => shell?.move(x, z), [shell]);

  return (
    <View style={styles.fill}>
      <Canvas ref={canvasRef} style={styles.fill} onLayout={onLayout} />

      {shell !== null && state === 'playing' && (
        <>
          <Hud snapshot={snapshot} onAction={press} onPause={() => shell.to('paused')} />
          <Joystick onMove={move} />
        </>
      )}

      {shell !== null && state === 'menu' && (
        <Screen title="Bone Tide">
          <Button label="Draw your sword" onPress={() => shell.startRun()} />
        </Screen>
      )}

      {shell !== null && state === 'paused' && (
        <Screen title="Paused">
          <Button label="Resume" onPress={() => shell.to('playing')} />
          <Button label="Restart" onPress={() => shell.startRun()} />
          <Button label="Return to camp" onPress={() => shell.quitToMenu()} />
        </Screen>
      )}

      {shell !== null && state === 'dead' && (
        <Screen title="You fell">
          <Text style={styles.note}>{snapshot.gameOver}</Text>
          <Button label="Rise again" onPress={() => shell.startRun()} />
          <Button label="Return to camp" onPress={() => shell.quitToMenu()} />
        </Screen>
      )}

      {shell === null && fatal === null && (
        <View style={styles.screen}>
          <Text style={styles.title}>Bone Tide</Text>
          <Text style={styles.note}>{progress.message}</Text>
          <View style={styles.loadTrack}>
            <View style={[styles.loadFill, { width: `${Math.round(progress.fraction * 100)}%` }]} />
          </View>
        </View>
      )}

      {fatal !== null && (
        <View style={styles.screen}>
          <Text style={styles.title}>{fatal.title}</Text>
          <Text style={styles.note}>{fatal.detail}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: 'rgba(6,8,11,0.82)',
  },
  title: { color: colors.gold, fontFamily: font.serif, fontSize: 40, letterSpacing: 4 },
  note: {
    color: colors.boneDim,
    fontFamily: font.serif,
    fontSize: 13,
    letterSpacing: 1,
    paddingHorizontal: 40,
    textAlign: 'center',
  },
  buttons: { alignItems: 'center', gap: 10 },
  button: {
    minWidth: 220,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.edge,
    borderRadius: 3,
    alignItems: 'center',
    backgroundColor: 'rgba(20,26,32,0.72)',
  },
  buttonLabel: { color: colors.bone, fontFamily: font.serif, fontSize: 15, letterSpacing: 1.5 },
  loadTrack: { width: 220, height: 3, backgroundColor: 'rgba(232,224,204,0.14)' },
  loadFill: { height: '100%', backgroundColor: colors.gold },
});
