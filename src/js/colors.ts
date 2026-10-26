// volledige klassenamen als literals, zodat Tailwind ze in deze bestanden vindt
import type { ColorName } from '../shared/types.ts';

export interface ColorClasses {
  label: string;
  bar: string;
  chip: string;
  dot: string;
  text: string;
}

export const COLORS: Record<ColorName, ColorClasses> = {
  red: { label: 'Rood', bar: 'border-cal-red', chip: 'bg-cal-red/20', dot: 'bg-cal-red', text: 'text-cal-red' },
  orange: {
    label: 'Oranje',
    bar: 'border-cal-orange',
    chip: 'bg-cal-orange/20',
    dot: 'bg-cal-orange',
    text: 'text-cal-orange',
  },
  yellow: {
    label: 'Geel',
    bar: 'border-cal-yellow',
    chip: 'bg-cal-yellow/20',
    dot: 'bg-cal-yellow',
    text: 'text-cal-yellow',
  },
  green: {
    label: 'Groen',
    bar: 'border-cal-green',
    chip: 'bg-cal-green/20',
    dot: 'bg-cal-green',
    text: 'text-cal-green',
  },
  blue: { label: 'Blauw', bar: 'border-cal-blue', chip: 'bg-cal-blue/20', dot: 'bg-cal-blue', text: 'text-cal-blue' },
  purple: {
    label: 'Paars',
    bar: 'border-cal-purple',
    chip: 'bg-cal-purple/20',
    dot: 'bg-cal-purple',
    text: 'text-cal-purple',
  },
  brown: {
    label: 'Bruin',
    bar: 'border-cal-brown',
    chip: 'bg-cal-brown/20',
    dot: 'bg-cal-brown',
    text: 'text-cal-brown',
  },
  gray: { label: 'Grijs', bar: 'border-cal-gray', chip: 'bg-cal-gray/20', dot: 'bg-cal-gray', text: 'text-cal-gray' },
};
