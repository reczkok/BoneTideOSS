import { rgb } from './types.ts';

export const PLAYER = {
  speed: 6.4,
  radius: 0.45,
  maxHp: 100,
  swingCooldown: 0.46,
  swingHitTime: 0.15,
  swingDuration: 0.42,
  attackDamage: 30,
  attackRange: 3.3,
  attackArcDeg: 100,
  attackArcMaxDeg: 170,
  attackKnock: 8,
  swingRefund: 0.2,
  swingRefundCap: 1.0,
  sparkStart: 0.06,
  sparkEnd: 0.27,
  sparkHeight: 0.95,
  sparkRadius: 1.65,
  stabReach: 2.6,
  stabLen: 1.9,
  stabWidth: 0.34,
  trailColor: rgb(1.7, 1.45, 0.8),
  trailGain: 1.4,
  trailArc: 0.55,
  trailWidth: 0.5,
  dashSpeed: 21,
  dashTime: 0.16,
  dashCooldown: 1.3,
  dashInvuln: 0.4,
  deathReportDelay: 2.4,
};

export const LOCO = {
  runRefSpeed: 5.6,
  minRate: 0.5,
  maxRate: 2.3,
  idleBelow: 0.35,
  maxLegTwistDeg: 95,
  spineTwist: 0.35,
  twistLerp: 12,
  backEnterDeg: 112,
  backExitDeg: 68,
  lowerBodyJoints: [
    'hips',
    'upperleg.l',
    'lowerleg.l',
    'foot.l',
    'toes.l',
    'upperleg.r',
    'lowerleg.r',
    'foot.r',
    'toes.r',
  ] as readonly string[],
  spineJoint: 'spine',
};

export const PLAYER_ANIM = {
  swing: { trim: 0.04, span: 0.44 },
  swingBack: { trim: 0.04, span: 0.28 },
  swingAlt: { trim: 0.1, span: 0.6 },
  castDur: 0.45,
  raiseDur: 0.7,
  dodgeDur: 0.42,
  dodgeSpan: 0.8,
  blendDur: 0.12,
};

export const TOUCH = {
  autoAimRange: 18,
  autoSwingSlack: 0.8,
  stickTravel: 0.34,
  stickSize: 100,
  stickMargin: 8,
};

export const SAVE_SLOTS = 3;

export const CAMERA = {
  offset: [0, 12.5, 11.0] as const,
  fovDeg: 46,
  near: 0.5,
  far: 220,
  zoomMin: 0.9,
  zoomMax: 1.5,
  coarseZoom: 1.15,
};
