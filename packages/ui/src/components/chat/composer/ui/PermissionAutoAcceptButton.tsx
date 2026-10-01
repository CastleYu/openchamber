/**
 * Toggles whether tool permissions are auto-accepted for this session.
 *
 * The pointer guards keep a tap from dismissing the mobile keyboard: on
 * Android's resizes-content viewport the keyboard-close relayout moves this
 * button mid-tap and the click never lands.
 */

import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { PermissionMode } from '@/stores/utils/permissionAutoAccept';

type PermissionAutoAcceptButtonProps = {
    footerIconButtonClass: string;
    iconSizeClass: string;
    isInteractive: boolean;
    permissionAutoAcceptEnabled: boolean;
    handlePermissionAutoAcceptToggle: () => void;
    permissionMode?: PermissionMode;
    handlePermissionModeCycle?: () => void;
    withTooltip?: boolean;
};

export const PermissionAutoAcceptButton = React.memo(function PermissionAutoAcceptButton(props: PermissionAutoAcceptButtonProps) {
    const { t } = useI18n();
    const {
        footerIconButtonClass,
        iconSizeClass,
        isInteractive,
        permissionAutoAcceptEnabled,
        handlePermissionAutoAcceptToggle,
        permissionMode,
        handlePermissionModeCycle,
        withTooltip = false,
    } = props;

    const legacyLabel = permissionAutoAcceptEnabled
        ? t('chat.chatInput.permissionAutoAccept.disable')
        : t('chat.chatInput.permissionAutoAccept.enable');
    const legacyTooltip = permissionAutoAcceptEnabled
        ? t('chat.chatInput.permissionAutoAccept.on')
        : t('chat.chatInput.permissionAutoAccept.off');
    const activeMode = handlePermissionModeCycle ? permissionMode : undefined;
    const ariaLabel = activeMode === 'safety' ? t('chat.chatInput.permissionMode.safety')
        : activeMode === 'auto' ? t('chat.chatInput.permissionMode.auto')
            : activeMode === 'ask' ? t('chat.chatInput.permissionMode.ask') : legacyLabel;
    const tooltipLabel = activeMode ? ariaLabel : legacyTooltip;
    const icon = activeMode === 'ask' ? 'shield-user' : activeMode === 'safety' ? 'shield-star' : 'shield-check';
    const color = activeMode === 'safety' ? 'var(--status-success)'
        : activeMode === 'auto' || (!activeMode && permissionAutoAcceptEnabled) ? 'var(--status-info)' : undefined;

    const button = (
        <button
            type="button"
            onClick={activeMode ? handlePermissionModeCycle : handlePermissionAutoAcceptToggle}
            className={cn(
                footerIconButtonClass,
                'rounded-md hover:bg-transparent',
                !isInteractive && 'opacity-30',
            )}
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            onPointerDownCapture={(event) => {
                if (event.pointerType === 'touch') {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
            aria-pressed={activeMode ? activeMode !== 'ask' : permissionAutoAcceptEnabled}
            aria-label={ariaLabel}
            title={ariaLabel}
        >
            <Icon name={icon} className={cn(iconSizeClass)} style={color ? { color } : undefined} />
        </button>
    );

    if (!withTooltip) {
        return button;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {button}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
                {tooltipLabel}
            </TooltipContent>
        </Tooltip>
    );
});
