// Small "i" button that shows a tooltip with the help text of a setting (spec 7B.5). Works by hover and by keyboard focus.
import { labelText } from '../lib/context';
import type { Tip } from '../lib/tooltips';
import type { SpecLabel } from '../engine/types';
import { useTip } from './Tooltip';

export function settingTip(title: string, p: { help: string; effect?: string; typical?: string; range?: string; spec: SpecLabel; learnMore?: string }): Tip {
  const fields = [
    ...(p.range ? [{ label: 'Allowed', value: p.range }] : []),
    ...(p.typical ? [{ label: 'Typical', value: p.typical }] : []),
    ...(p.effect ? [{ label: 'Effect', value: p.effect }] : []),
  ];
  return { title, fields, sentence: p.help, label: labelText(p.spec), learnMore: p.learnMore };
}

export function Info({ tip, name }: { tip: Tip; name: string }) {
  const h = useTip(() => tip);
  return <button type="button" className="icon info" aria-label={`About ${name}`} {...h}>i</button>;
}
