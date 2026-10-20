import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import type { AcpControls as Controls } from '@/lib/opencode/acp';

export interface AcpControlsProps {
    controls?: Controls;
    error?: string;
    changing: boolean;
    disabled: boolean;
    onChange: (configId: string | null, value: string) => Promise<void>;
}

export function AcpControls({ controls, error, changing, disabled, onChange }: AcpControlsProps) {
    const { t } = useI18n();
    const options = controls?.configOptions ?? [];
    const modes = options.length ? undefined : controls?.modes;
    return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 typography-meta text-muted-foreground">
        {options.map((option) => <Select key={option.id} value={option.currentValue} disabled={disabled || changing} onValueChange={(value) => { void onChange(option.id, value); }}>
            <SelectTrigger className="max-w-48 min-w-0" aria-label={option.name} title={option.description ?? option.name}>
                <SelectValue>{option.options.flatMap((entry) => 'group' in entry ? entry.options : [entry]).find((entry) => entry.value === option.currentValue)?.name ?? option.currentValue}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {option.options.map((entry) => 'group' in entry
                    ? <SelectGroup key={entry.group}><SelectLabel>{entry.name}</SelectLabel>{entry.options.map((choice) => <SelectItem key={choice.value} value={choice.value} title={choice.description}>{choice.name}</SelectItem>)}</SelectGroup>
                    : <SelectItem key={entry.value} value={entry.value} title={entry.description}>{entry.name}</SelectItem>)}
            </SelectContent>
        </Select>)}
        {modes ? <Select value={modes.currentModeId} disabled={disabled || changing} onValueChange={(value) => { void onChange(null, value); }}>
            <SelectTrigger className="max-w-48 min-w-0" aria-label={t('chat.acp.mode')}><SelectValue>{modes.availableModes.find((mode) => mode.id === modes.currentModeId)?.name ?? modes.currentModeId}</SelectValue></SelectTrigger>
            <SelectContent>{modes.availableModes.map((mode) => <SelectItem key={mode.id} value={mode.id} title={mode.description}>{mode.name}</SelectItem>)}</SelectContent>
        </Select> : null}
        {!options.length && !modes ? <span>{t('chat.acp.agentManaged')}</span> : null}
        {controls?.usage ? <span className="whitespace-nowrap" title={t('chat.acp.contextUsage')}>
            {controls.usage.used.toLocaleString()} / {controls.usage.size.toLocaleString()}
            {controls.usage.cost ? ` · ${controls.usage.cost.amount.toLocaleString()} ${controls.usage.cost.currency}` : ''}
        </span> : null}
        {error ? <span role="alert" className="text-[var(--status-error-text)]">{t('chat.acp.controlsFailed', { reason: error })}</span> : null}
    </div>;
}
