import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Touchable } from 'react-native-gesture-handler';
import { formatTime } from '@bonetide/engine/game/hud.ts';
import type { Action } from '@bonetide/engine/game/input.ts';
import type { HudSnapshot } from '../src/ui/hudBridge.ts';
import { colors, font } from '../src/ui/theme.ts';

function Bar({ frac, tint }: { frac: number; tint: string }) {
  return (
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(0, Math.min(1, frac)) * 100}%`, backgroundColor: tint },
        ]}
      />
    </View>
  );
}

function ActionButton({
  label,
  sub,
  enabled,
  onPress,
}: {
  label: string;
  sub?: string;
  enabled: boolean;
  onPress(): void;
}) {
  return (
    <Touchable
      style={[styles.action, enabled ? styles.actionReady : styles.actionLocked]}
      disabled={!enabled}
      onPressIn={onPress}
      activeOpacity={0.55}
      animationDuration={0}
    >
      <Text style={styles.actionLabel}>{label}</Text>
      {sub ? <Text style={styles.actionSub}>{sub}</Text> : null}
    </Touchable>
  );
}

export function Hud({
  snapshot,
  onAction,
  onPause,
}: {
  snapshot: HudSnapshot;
  onAction(action: Action): void;
  onPause(): void;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.topbar} pointerEvents="none">
        <Text style={styles.stat}>{formatTime(snapshot.time)}</Text>
        <Text style={styles.stat}>WAVE {snapshot.wave}</Text>
        <Text style={styles.stat}>{snapshot.kills} slain</Text>
        <Text style={styles.stat}>LV {snapshot.level}</Text>
      </View>

      <View style={styles.vitals} pointerEvents="none">
        <Bar frac={snapshot.hp / Math.max(1, snapshot.maxHp)} tint={colors.blood} />
        <Bar frac={snapshot.xpFrac} tint={colors.gold} />
      </View>

      {snapshot.boss >= 0 && (
        <View style={styles.bossBar} pointerEvents="none">
          <Text style={styles.bossLabel}>BOSS</Text>
          <Bar frac={snapshot.boss} tint={colors.blood} />
        </View>
      )}

      {snapshot.banner !== '' && (
        <Text style={styles.banner} pointerEvents="none">
          {snapshot.banner}
        </Text>
      )}

      <Touchable style={styles.pause} onPress={onPause} activeOpacity={0.55} animationDuration={0}>
        <Text style={styles.actionLabel}>II</Text>
      </Touchable>

      <View style={styles.actionbar}>
        <ActionButton
          label="ULT"
          sub={`${Math.round(snapshot.ultCharge * 100)}%`}
          enabled={snapshot.ultCharge >= 1}
          onPress={() => onAction('ult')}
        />
        <ActionButton
          label="DASH"
          enabled={snapshot.ready['dash'] !== false}
          onPress={() => onAction('dash')}
        />
        {snapshot.slots.map((slot, i) =>
          slot ? (
            <ActionButton
              key={slot.name}
              label={slot.name}
              enabled={snapshot.ready[`slot${i}`] !== false}
              onPress={() => onAction(`slot${i}` as Action)}
            />
          ) : null,
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
  },
  stat: { color: colors.bone, fontFamily: font.serif, fontSize: 13, letterSpacing: 1.5 },
  vitals: { position: 'absolute', top: 40, left: 28, width: 180, gap: 5 },
  barTrack: {
    height: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(232,224,204,0.2)',
  },
  barFill: { height: '100%' },
  bossBar: { position: 'absolute', top: 42, alignSelf: 'center', width: 260, alignItems: 'center' },
  bossLabel: {
    color: colors.blood,
    fontFamily: font.serif,
    fontSize: 11,
    letterSpacing: 3,
    marginBottom: 4,
  },
  banner: {
    position: 'absolute',
    top: '24%',
    alignSelf: 'center',
    color: colors.gold,
    fontFamily: font.serif,
    fontSize: 22,
    letterSpacing: 3,
  },
  pause: {
    position: 'absolute',
    top: 12,
    right: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(232,224,204,0.22)',
    borderRadius: 3,
  },
  actionbar: { position: 'absolute', right: 24, bottom: 26, flexDirection: 'row', gap: 10 },
  action: {
    minWidth: 62,
    height: 62,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(10,14,18,0.7)',
  },
  actionReady: { borderColor: 'rgba(224,189,106,0.65)' },
  actionLocked: { borderColor: 'rgba(232,224,204,0.16)', opacity: 0.4 },
  actionLabel: { color: colors.bone, fontFamily: font.serif, fontSize: 12, letterSpacing: 1.2 },
  actionSub: { color: colors.boneDim, fontFamily: font.serif, fontSize: 10, marginTop: 2 },
});
