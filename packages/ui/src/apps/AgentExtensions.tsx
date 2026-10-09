import React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { AgentExtensions, type AgentExtensionContext } from '@/lib/agent/extensions';
import { parseExtensionInput, type ExtensionField, type ExtensionManifest, type ExtensionScalar, type ExtensionValueSpec } from '../../../web/server/lib/agent/extensions.js';
import type { JsonValue } from '../../../web/server/lib/agent/dispatcher.js';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION } from '../../../web/server/lib/agent/constants.js';
const { KIND, EFFECT } = AGENT_EXTENSION;

type DraftValue = string | boolean | string[];
type Draft = Record<string, DraftValue>;

const label = (value: { en: string; zhCN: string }, locale: string) => locale === 'zh-CN' ? value.zhCN : value.en;
const defaultValue = (value: ExtensionValueSpec): DraftValue => value.kind === KIND.BOOLEAN ? false : value.kind === KIND.LIST ? [] : '';
const valuesFor = (fields: ExtensionField[]): Draft => Object.fromEntries(fields.map(({ key, value }) => [key, defaultValue(value)]));

function ScalarInput({ spec, value, onChange, disabled, id, ariaLabel }: {
  spec: ExtensionScalar; value: string | boolean; onChange: (value: string | boolean) => void; disabled: boolean; id: string; ariaLabel: string;
}) {
  const { t, locale } = useI18n();
  if (spec.kind === KIND.BOOLEAN) return <Checkbox ariaLabel={ariaLabel} checked={value === true} disabled={disabled} onChange={onChange} />;
  if (spec.kind === KIND.CHOICE) return <Select value={String(value)} disabled={disabled} onValueChange={(next) => onChange(next)}>
    <SelectTrigger id={id} className="w-full"><SelectValue placeholder={t('agent.extensions.choose')} /></SelectTrigger>
    <SelectContent>{spec.choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{label(choice.label, locale)}</SelectItem>)}</SelectContent>
  </Select>;
  return <Input id={id} type={spec.kind === KIND.NUMBER ? 'number' : 'text'} value={String(value)} disabled={disabled}
    step={spec.kind === KIND.NUMBER ? 'any' : undefined}
    maxLength={spec.kind === KIND.TEXT ? spec.maxLength : undefined} min={spec.kind === KIND.NUMBER ? spec.min : undefined}
    max={spec.kind === KIND.NUMBER ? spec.max : undefined} onChange={(event) => onChange(event.target.value)} />;
}

function FieldEditor({ field, value, onChange, disabled, id }: {
  field: ExtensionField; value: DraftValue; onChange: (value: DraftValue) => void; disabled: boolean; id: string;
}) {
  const { locale, t } = useI18n();
  const fieldLabel = label(field.label, locale);
  const spec = field.value;
  if (spec.kind !== KIND.LIST) return <ScalarInput id={id} spec={spec} value={Array.isArray(value) ? '' : value} onChange={onChange} disabled={disabled} ariaLabel={fieldLabel} />;
  const rows = Array.isArray(value) ? value : [];
  return <div className="space-y-2" role="group" aria-label={fieldLabel}>
    {rows.map((item, index) => <div className="flex items-center gap-2" key={`${id}-${index}`}>
      <ScalarInput id={`${id}-${index}`} spec={spec.item} value={spec.item.kind === KIND.BOOLEAN ? item === 'true' : item} ariaLabel={`${fieldLabel} ${index + 1}`}
        disabled={disabled} onChange={(next) => onChange(rows.map((row, rowIndex) => rowIndex === index ? String(next) : row))} />
      <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>{t('agent.extensions.remove')}</Button>
    </div>)}
    <Button type="button" variant="outline" size="xs" disabled={disabled || rows.length >= spec.maxItems}
      onClick={() => onChange([...rows, spec.item.kind === KIND.BOOLEAN ? 'false' : ''])}>{t('agent.extensions.add')}</Button>
    <span className="sr-only">{fieldLabel}</span>
  </div>;
}

function scalarValue(spec: ExtensionScalar, draft: string | boolean): string | number | boolean {
  if (spec.kind === KIND.BOOLEAN) return draft === true;
  if (spec.kind === KIND.NUMBER) {
    if (String(draft).trim() === '') throw new Error(AGENT_ERROR.INVALID_INPUT);
    const value = Number(draft);
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw new Error(AGENT_ERROR.INVALID_INPUT);
    return value;
  }
  if (spec.kind === KIND.TEXT && String(draft).length > spec.maxLength) throw new Error(AGENT_ERROR.INVALID_INPUT);
  if (spec.kind === KIND.CHOICE && !spec.choices.some((choice) => choice.value === draft)) throw new Error(AGENT_ERROR.INVALID_INPUT);
  return String(draft);
}

function buildValues(fields: ExtensionField[], draft: Draft, included: ReadonlySet<string>, manifest: ExtensionManifest): JsonValue {
  const raw: Record<string, JsonValue> = {};
  for (const field of fields) {
    const current = draft[field.key];
    if (current === undefined || (!field.required && !included.has(field.key))) continue;
    if (field.value.kind === KIND.LIST) raw[field.key] = (Array.isArray(current) ? current : []).map((item) =>
      scalarValue(field.value.kind === KIND.LIST ? field.value.item : field.value, field.value.kind === KIND.LIST && field.value.item.kind === KIND.BOOLEAN ? item === 'true' : item));
    else {
      if (Array.isArray(current)) throw new Error(AGENT_ERROR.INVALID_INPUT);
      raw[field.key] = scalarValue(field.value, current);
    }
  }
  parseExtensionInput(manifest, raw);
  return raw;
}

export function AgentExtensionsPanel({ controller, context, blocked = false }: {
  controller: AgentExtensions; context: AgentExtensionContext; blocked?: boolean;
}) {
  const { locale, t } = useI18n();
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [selected, setSelected] = React.useState('');
  const [draft, setDraft] = React.useState<Draft>({});
  const [included, setIncluded] = React.useState<Set<string>>(() => new Set());
  const [invalid, setInvalid] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const formKey = React.useRef('');
  const ids = React.useId();
  const { workspaceID, sessionID } = context;

  React.useEffect(() => { void controller.open({ workspaceID, sessionID }).catch(() => {}); }, [controller, workspaceID, sessionID]);
  const action = state.state === 'ready' ? state.actions.find((item) => item.manifest.actionID === selected) : undefined;
  const fields = action?.manifest.input ?? [];
  const pendingMutation = state.state === 'ready' && state.pending.length > 0 && action?.manifest.effect === EFFECT.MUTATION;
  const taskRunning = state.state === 'ready' && state.task.state === 'running';
  const catalogFailed = state.state === 'ready' && state.catalogError !== null;
  const unavailable = !action || !action.availability.available;
  const missingContext = Boolean(action && ((action.manifest.context.workspace && !context.workspaceID)
    || (action.manifest.context.session && !context.sessionID)));
  const disabled = (blocked && action?.manifest.effect === EFFECT.MUTATION) || pendingMutation || taskRunning || running || unavailable || missingContext || catalogFailed;

  React.useEffect(() => {
    if (!action) return;
    const key = JSON.stringify([workspaceID, sessionID, action.manifest.actionID, action.manifest.revision]);
    if (formKey.current === key) return;
    formKey.current = key;
    setDraft(valuesFor(action.manifest.input));
    setIncluded(new Set());
    setInvalid(false);
    setFailed(false);
  }, [action, workspaceID, sessionID]);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action || disabled) return;
    let values: JsonValue;
    try { values = buildValues(fields, draft, included, action.manifest); } catch {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFailed(false);
    setRunning(true);
    try { await controller.run(action.manifest.actionID, values, action.manifest.effect === EFFECT.MUTATION ? crypto.randomUUID() : undefined); }
    catch { setFailed(true); }
    finally { setRunning(false); }
  };

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-labelledby={`${ids}-title`}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${ids}-title`} className="typography-ui-header">{t('agent.extensions.title')}</h2>
      <Button type="button" variant="outline" size="sm" disabled={state.state !== 'ready' || running || taskRunning} onClick={() => { void controller.refresh().catch(() => {}); }}>{t('agent.extensions.refresh')}</Button>
    </div>
    {state.state === 'loading' ? <p role="status">{t('common.loading')}</p> : null}
    {state.state === 'failed' ? <div role="alert" className="space-y-2"><p>{t('agent.extensions.failed')}</p><Button type="button" variant="outline" onClick={() => { void controller.open({ workspaceID, sessionID }).catch(() => {}); }}>{t('agent.extensions.retry')}</Button></div> : null}
    {state.state === 'retired' ? <p role="status">{t('agent.chat.unavailable')}</p> : null}
    {state.state === 'empty' ? <p>{t('agent.extensions.empty')}</p> : null}
    {state.state === 'ready' ? <>
      {state.actions.length === 0 ? <p>{t('agent.extensions.empty')}</p> : <div className="space-y-1">
        {state.actions.map(({ manifest, availability }) => <Button key={manifest.actionID} type="button" disabled={!availability.available} variant={selected === manifest.actionID ? 'secondary' : 'ghost'}
          className="w-full justify-start" aria-pressed={selected === manifest.actionID}
          onClick={() => setSelected(manifest.actionID)}>{label(manifest.label, locale)}{!availability.available ? ` · ${t('agent.chat.unavailable')}` : ''}</Button>)}
      </div>}
      {action ? <>
        {!action.availability.available ? <p>{t('agent.chat.unavailable')}</p> : null}
        {missingContext ? <p role="status">{t('agent.extensions.contextRequired')}</p> : null}
        <form className="space-y-3" onSubmit={(event) => { void run(event); }}>
          {fields.map((field) => <div key={field.key} className="space-y-2">
            {field.required && field.value.kind !== KIND.BOOLEAN && field.value.kind !== KIND.LIST ? <label htmlFor={`${ids}-${field.key}`}>{label(field.label, locale)}</label> : field.required ? <p>{label(field.label, locale)}</p> : <label className="flex items-center gap-2">
              <Checkbox checked={included.has(field.key)} disabled={disabled} onChange={(checked) => setIncluded((old) => {
                const next = new Set(old); if (checked) next.add(field.key); else next.delete(field.key); return next;
              })} />{t('agent.extensions.include')} {label(field.label, locale)}
            </label>}
            {(field.required || included.has(field.key)) ? <FieldEditor id={`${ids}-${field.key}`} field={field} value={draft[field.key] ?? defaultValue(field.value)}
              disabled={disabled} onChange={(value) => setDraft((old) => ({ ...old, [field.key]: value }))} /> : null}
          </div>)}
          {invalid ? <p role="alert" className="text-destructive">{t('agent.extensions.invalid')}</p> : null}
          <Button type="submit" disabled={disabled}>{t('agent.extensions.run')}</Button>
        </form>
      </> : null}
      {catalogFailed ? <p role="alert" className="text-destructive">{t('agent.extensions.failed')}</p> : null}
      {state.error || failed ? <p role="alert" className="text-destructive">{t('agent.chat.failed')}</p> : null}
      {state.result?.actionID === selected ? <div className="space-y-2 rounded-md border border-border p-3">
        <h3 className="typography-ui-label">{t('agent.extensions.result')}</h3>
        {'text' in state.result.result ? <p className="whitespace-pre-wrap break-words">{state.result.result.text}</p> : null}
        {'fields' in state.result.result ? <dl className="grid gap-2 sm:grid-cols-2">{action?.manifest.output.kind === KIND.FIELDS ? action.manifest.output.fields.map((field) => <div key={field.key}><dt className="text-muted-foreground">{label(field.label, locale)}</dt><dd>{state.result?.actionID === selected && 'fields' in state.result.result && state.result.result.fields[field.key] !== undefined ? String(state.result.result.fields[field.key]) : t('agent.extensions.absent')}</dd></div>) : null}</dl> : null}
        {'rows' in state.result.result ? <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{action?.manifest.output.kind === KIND.TABLE ? action.manifest.output.columns.map((column) => <th key={column.key} className="p-2">{label(column.label, locale)}</th>) : null}</tr></thead><tbody>{state.result.result.rows.map((row, index) => <tr key={index}>{action?.manifest.output.kind === KIND.TABLE ? action.manifest.output.columns.map((column) => <td key={column.key} className="border-t border-border p-2">{row[column.key] === undefined ? t('agent.extensions.absent') : String(row[column.key])}</td>) : null}</tr>)}</tbody></table></div> : null}
        {state.result.receipt ? <p role="status">{t(state.result.receipt.state === AGENT_ATTEMPT.ACCEPTED ? 'agent.extensions.accepted' : 'agent.extensions.complete')}</p> : null}
      </div> : null}
      {state.pending.map(({ actionID, requestID }) => <div key={requestID} role="alert" className="flex items-center justify-between gap-3">
        <span>{t('agent.chat.unknown')} ({actionID})</span><Button type="button" variant="outline" size="sm" disabled={running || taskRunning} onClick={() => { void controller.resolve(requestID).catch(() => {}); }}>{t('agent.chat.resolve')}</Button>
      </div>)}
    </> : null}
  </section>;
}

