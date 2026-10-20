import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';
import { opencodeClient } from '@/lib/opencode/client';
import type { AcpInteraction, AcpAnswer, AcpValues, AcpField } from '@/lib/opencode/acp-interactions';

const initialValues = (request: AcpInteraction): AcpValues => request.mode === 'url' ? {} : Object.fromEntries(request.fields.flatMap((field) => field.default !== undefined ? [[field.key, field.default]] : field.type === 'boolean' ? [[field.key, false]] : []));
const answerValues = (fields: AcpField[], values: AcpValues): AcpValues => Object.fromEntries(fields.flatMap((field) => {
  const value = values[field.key];
  if (value === undefined || value === '' && !field.required) return [];
  return [[field.key, field.type === 'number' || field.type === 'integer' ? Number(value) : value]];
}));
const reply = (id: string, answer: AcpAnswer) => opencodeClient.replyToAcpInput(id, answer);

/** Ordinary data stays reviewable. Sensitive workflows open only on consent. */
export function AcpInteractionCard({ request, respond = reply }: { request: AcpInteraction; respond?: (id: string, answer: AcpAnswer) => Promise<boolean> }) {
  const { t } = useI18n();
  const [values, setValues] = React.useState(() => initialValues(request));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [responded, setResponded] = React.useState(false);
  const waiting = request.state === 'waiting' || responded;
  const update = (key: string, value: AcpValues[string]) => setValues((previous) => ({ ...previous, [key]: value }));
  const send = async (action: AcpAnswer['action']) => {
    setBusy(true); setError(null);
    try {
      // Start navigation inside the click gesture. Never embed, prefetch or inspect it.
      if (action === 'accept' && request.mode === 'url' && !await openExternalUrl(request.url)) throw new Error(t('chat.acp.openFailed'));
      const answer: AcpAnswer = { action };
      if (action === 'accept' && request.mode === 'form') answer.content = answerValues(request.fields, values);
      await respond(request.id, answer);
      setResponded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 py-3" aria-label={request.agent}>
    <p className="typography-meta font-medium text-foreground">{request.agent}</p>
    <p className="whitespace-pre-wrap break-words typography-meta text-foreground">{request.message}</p>
    {request.mode === 'url' ? <>
      <p className="break-all font-mono typography-meta text-foreground">{new URL(request.url).host}</p>
      <p className="break-all font-mono typography-micro text-muted-foreground">{request.url}</p>
      {waiting && <p role="status" className="typography-meta text-muted-foreground">{t('chat.acp.waiting')}</p>}
    </> : <p className="typography-micro text-muted-foreground">{t('chat.acp.noSecrets')}</p>}
    {!waiting && <form onSubmit={(event) => { event.preventDefault(); void send('accept'); }} className="space-y-3">
      {request.mode === 'form' && request.fields.map((field) => <label key={field.key} className="block space-y-1 typography-meta text-foreground">
        <span>{field.title ?? field.key}{field.required ? ' *' : ''}</span>
        {field.description && <span className="block whitespace-pre-wrap break-words text-muted-foreground">{field.description}</span>}
        {field.type === 'boolean' ? <Checkbox checked={values[field.key] === true} onChange={(checked) => update(field.key, checked)} disabled={busy} ariaLabel={field.title ?? field.key} />
          : field.type === 'array' ? <div className="flex flex-wrap gap-2">{field.choices.map((item) => {
            const current = values[field.key];
            const selected = Array.isArray(current) ? current : [];
            return <Button key={item.value} type="button" size="xs" variant="chip" aria-pressed={selected.includes(item.value)} disabled={busy} onClick={() => update(field.key, selected.includes(item.value) ? selected.filter((value) => value !== item.value) : [...selected, item.value])}>{item.label}</Button>;
          })}</div>
            : field.type === 'string' && field.choices ? <Select value={String(values[field.key] ?? '')} onValueChange={(value) => update(field.key, value)} disabled={busy}>
              <SelectTrigger className="max-w-96" aria-label={field.title ?? field.key}><SelectValue /></SelectTrigger>
              <SelectContent>{field.choices.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
              : <Input aria-label={field.title ?? field.key} value={String(values[field.key] ?? '')} onChange={(event) => update(field.key, event.target.value)} disabled={busy} required={field.required} type={field.type === 'number' || field.type === 'integer' ? 'number' : field.type === 'string' && field.format === 'email' ? 'email' : 'text'} min={field.type === 'number' || field.type === 'integer' ? field.minimum : undefined} max={field.type === 'number' || field.type === 'integer' ? field.maximum : undefined} step={field.type === 'integer' ? 1 : 'any'} minLength={field.type === 'string' ? field.minLength : undefined} maxLength={field.type === 'string' ? field.maxLength : undefined} className="max-w-96" />}
      </label>)}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>{t(request.mode === 'url' ? 'chat.acp.open' : 'chat.acp.submit')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void send('decline')}>{t('chat.acp.decline')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void send('cancel')}>{t('chat.acp.cancel')}</Button>
      </div>
    </form>}
    {error && <p role="alert" className="break-words typography-meta text-[var(--status-error-text)]">{error}</p>}
  </section>;
}
