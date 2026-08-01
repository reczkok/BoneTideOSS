import { Platform } from 'react-native';

export const colors = {
  bone: '#e8e0cc',
  boneDim: '#a9a291',
  gold: '#e0bd6a',
  blood: '#b8452f',
  ink: '#0b0e12',
  edge: 'rgba(232,224,204,0.22)',
};

export const font = {
  serif: Platform.select({ ios: 'Georgia', default: 'serif' }),
};
