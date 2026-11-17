// Display names and the narrowband/Wi-Fi split used by the conflict and arbitration code.
import type { AirBlock, Tech } from './types';

export const TECH_NAME: Record<Tech, string> = { BT: 'Bluetooth', WIFI: 'Wi-Fi', THREAD: 'Thread' };

/** Bluetooth and Thread are one side of every conflict and Wi-Fi is the other. */
export type Side = 'BT' | 'WIFI';
export const sideOfTech = (t: Tech): Side => (t === 'WIFI' ? 'WIFI' : 'BT');
export const sideOf = (b: Pick<AirBlock, 'tech'>): Side => sideOfTech(b.tech);
