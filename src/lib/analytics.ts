// Optional visitor statistics. Privacy-friendly: no cookies, no personal data, and nothing is sent when the browser says Do Not Track.
import raw from '../data/analytics.json';

export interface AnalyticsConfig { provider: string; siteCode: string }
export const analytics = raw as AnalyticsConfig;

/** A GoatCounter site code is a short lower-case name. Anything else is treated as not set up. */
export const validCode = (c: string): boolean => /^[a-z0-9][a-z0-9-]{1,30}$/.test(c);
export const isConfigured = (c: AnalyticsConfig = analytics): boolean => c.provider === 'goatcounter' && validCode(c.siteCode);
export const dashboardUrl = (c: AnalyticsConfig = analytics): string | null => (isConfigured(c) ? `https://${c.siteCode}.goatcounter.com/` : null);
export const countUrl = (c: AnalyticsConfig = analytics): string | null => (isConfigured(c) ? `https://${c.siteCode}.goatcounter.com/count` : null);

export interface Env { hostname: string; search: string; doNotTrack?: string | null }
/** Count visits only on the published site: not on localhost, not in the browser checks (?e2e), and not when Do Not Track is on. */
export function shouldCount(env: Env, c: AnalyticsConfig = analytics): boolean {
  if (!isConfigured(c)) return false;
  if (env.hostname === 'localhost' || env.hostname === '127.0.0.1' || env.hostname === '') return false;
  if (env.search.includes('e2e')) return false;
  if (env.doNotTrack === '1' || env.doNotTrack === 'yes') return false;
  return true;
}

/** Add the counting script to the page. Returns whether it was added. */
export function startCounting(): boolean {
  const c = countUrl();
  const env: Env = { hostname: window.location.hostname, search: window.location.search, doNotTrack: navigator.doNotTrack };
  if (!c || !shouldCount(env)) return false;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = c;
  document.head.appendChild(s);
  return true;
}
