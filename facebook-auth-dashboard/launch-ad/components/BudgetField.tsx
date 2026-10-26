'use client';
import type { FormState } from '@/launch-ad/lib/types';
import { Field, Segmented, TextInput } from './ui';

/**
 * Budget input shown in both the Campaign card and the Ad Set card.
 * Both edit the same budget; typing an amount at one level disables the other until it's cleared.
 */
export default function BudgetField({ level, budget, onChange, symbol, disabledReason, label, hint }: {
  level: 'CAMPAIGN' | 'ADSET';
  budget: FormState['budget'];
  onChange: (patch: Partial<FormState['budget']>) => void;
  symbol: string;
  disabledReason?: string;
  label: string;
  hint?: string;
}) {
  const mine = budget.level === level;
  const disabled = !!disabledReason;
  const amount = mine ? budget.amount : '';
  return (
    <Field label={label} hint={disabledReason || hint}>
      <div style={{ opacity: disabled ? 0.55 : 1 }}>
        <Segmented
          value={mine ? budget.type : 'DAILY'}
          onChange={(v) => { if (!disabled) onChange({ type: v, level }); }}
          options={[
            { key: 'DAILY', label: 'Daily budget', disabled },
            { key: 'LIFETIME', label: 'Lifetime budget', disabled },
          ]}
        />
        <div className="field" style={{ marginTop: 10 }}>
          <TextInput
            inputMode="decimal"
            disabled={disabled}
            value={amount}
            aria-label={label}
            placeholder={`Enter an amount (${symbol.trim()})`}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, '');
              onChange({ amount: v, level });
            }}
          />
        </div>
      </div>
    </Field>
  );
}
