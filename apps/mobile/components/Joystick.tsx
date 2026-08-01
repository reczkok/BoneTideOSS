import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  type PanGestureConfig,
  type PanGestureEvent,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const RADIUS = 62;
const KNOB = 46;
/** Extra touchable margin around the pad so a thumb landing slightly off still grabs it. */
const HIT_SLOP = 40;
const RECENTER = { damping: 18, stiffness: 320, mass: 0.6 };

/**
 * Virtual thumbstick. The knob follows the finger on the UI thread through
 * shared values; the normalized axis is forwarded to the engine on the JS
 * thread with `scheduleOnRN`. Being a Gesture Handler pan rather than a
 * responder-system view, it coexists with action buttons held by other fingers.
 */
export function Joystick({ onMove }: { onMove(x: number, z: number): void }) {
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);

  const config = useMemo<PanGestureConfig>(() => {
    const steer = (event: PanGestureEvent) => {
      'worklet';
      let dx = event.x - RADIUS;
      let dy = event.y - RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx *= RADIUS / len;
        dy *= RADIUS / len;
      }
      knobX.value = dx;
      knobY.value = dy;
      scheduleOnRN(onMove, dx / RADIUS, dy / RADIUS);
    };
    const release = () => {
      'worklet';
      knobX.value = withSpring(0, RECENTER);
      knobY.value = withSpring(0, RECENTER);
      scheduleOnRN(onMove, 0, 0);
    };
    return {
      minDistance: 0,
      maxPointers: 1,
      hitSlop: HIT_SLOP,
      onBegin: steer,
      onUpdate: steer,
      onFinalize: release,
    };
  }, [knobX, knobY, onMove]);

  const pan = usePanGesture(config);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.pad}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pad: {
    position: 'absolute',
    left: 28,
    bottom: 28,
    width: RADIUS * 2,
    height: RADIUS * 2,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(232,224,204,0.22)',
    backgroundColor: 'rgba(8,11,15,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: 'rgba(232,224,204,0.28)',
  },
});
