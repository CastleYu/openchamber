import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsControlGroup, SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import type { AcpProjectMapping } from '@/lib/agent-connection';

interface AcpProjectMappingsProps {
  value: AcpProjectMapping[];
  onChange: (value: AcpProjectMapping[]) => void;
  disabled: boolean;
}

export function AcpProjectMappings({ value, onChange, disabled }: AcpProjectMappingsProps) {
  const { t } = useI18n();
  const ids = React.useRef<number[]>([]);
  const next = React.useRef(0);
  while (ids.current.length < value.length) ids.current.push(next.current++);
  ids.current.length = value.length;
  const update = (index: number, patch: Partial<AcpProjectMapping>) => {
    onChange(value.map((row, position) => position === index ? { ...row, ...patch } : row));
  };
  const remove = (index: number) => {
    ids.current.splice(index, 1);
    onChange(value.filter((_, position) => position !== index));
  };
  return (
    <SettingsControlGroup title={t('settings.agentConnection.projectMappings')} info={t('settings.agentConnection.projectMappingsInfo')}>
      <div className="space-y-4">
        {value.map((row, index) => <SettingsControlGroup key={ids.current[index]} contentClassName="space-y-2">
          <SettingsFieldRow label={t('settings.agentConnection.projectDirectory')}>
            <Input aria-label={t('settings.agentConnection.projectDirectoryRow', { number: index + 1 })} value={row.directory} onChange={(event) => update(index, { directory: event.target.value })} disabled={disabled} className="h-8 max-w-96 font-mono" />
          </SettingsFieldRow>
          <SettingsFieldRow label={t('settings.agentConnection.remoteCwd')}>
            <Input aria-label={t('settings.agentConnection.remoteCwdRow', { number: index + 1 })} value={row.cwd} onChange={(event) => update(index, { cwd: event.target.value })} disabled={disabled} className="h-8 max-w-96 font-mono" />
          </SettingsFieldRow>
          <Button variant="ghost" size="sm" disabled={disabled} aria-label={t('settings.agentConnection.removeMappingRow', { number: index + 1 })} onClick={() => remove(index)}>{t('settings.agentConnection.removeMapping')}</Button>
        </SettingsControlGroup>)}
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...value, { directory: '', cwd: '' }])}>{t('settings.agentConnection.addMapping')}</Button>
      </div>
    </SettingsControlGroup>
  );
}
