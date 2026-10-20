import React, { memo } from 'react';
import {
    DndContext,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { QUEUE_ATTEMPT, isQueueUnresolved, isServerOwnedMessageQueue, QUEUE_DELIVERY, getMessageQueueKey, useMessageQueueStore, type MessageQueueTarget, type QueuedMessage } from '@/stores/messageQueueStore';
import { useInputStore } from '@/sync/input-store';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { Icon } from "@/components/icon/Icon";
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ComposerFloatingPanel } from './composer/ui/ComposerFloatingPanel';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { getQueuedMessagePreview } from '@/lib/messages/queuedMessagePreview';

const ATTEMPT_LABEL = {
    [QUEUE_ATTEMPT.PENDING]: 'chat.queuedMessage.attemptPending',
    [QUEUE_ATTEMPT.ACCEPTED]: 'chat.queuedMessage.attemptAccepted',
    [QUEUE_ATTEMPT.UNKNOWN]: 'chat.queuedMessage.attemptUnknown',
    [QUEUE_ATTEMPT.COMPLETED]: 'chat.queuedMessage.attemptCompleted',
    [QUEUE_ATTEMPT.FAILED]: 'chat.queuedMessage.attemptFailed',
} as const;

interface QueuedMessageChipProps {
    blocked: boolean;
    onResubmit: (message: QueuedMessage) => void;
    message: QueuedMessage;
    target: MessageQueueTarget;
    onEdit: (message: QueuedMessage) => void;
    onSend: (message: QueuedMessage) => void;
}

const QueuedMessageChip = memo(({ message, target, blocked, onEdit, onSend, onResubmit }: QueuedMessageChipProps) => {
    const { t } = useI18n();
    const removeFromQueue = useMessageQueueStore((state) => state.removeFromQueue);
    const sending = useMessageQueueStore(state => state.sendingIds[getMessageQueueKey(target)]?.includes(message.id) ?? false);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: message.id, disabled: blocked });

    const firstLine = getQueuedMessagePreview(message);
    const held = message.delivery !== undefined && message.delivery !== QUEUE_DELIVERY.READY;

    const attachmentCount = message.attachments?.length ?? 0;

    return (
        <div
            ref={setNodeRef}
            // Translate only (no scaleX/scaleY) so the lifted row keeps its size.
            style={{ transform: CSS.Translate.toString(transform), transition }}
            className={cn('flex min-w-0 items-center gap-2 py-1', isDragging && 'z-10 opacity-60')}
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                className="flex flex-shrink-0 cursor-grab touch-none select-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                disabled={blocked}
                aria-label={t('chat.queuedMessage.reorderAria')}
            >
                <Icon name="draggable" className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-0 flex-1 typography-ui-label text-foreground">
                <span className="block truncate">
                {firstLine || t('chat.queuedMessage.empty')}
                {attachmentCount > 0 && (
                    <span className="ml-1 text-muted-foreground">{t('chat.queuedMessage.attachments', { count: attachmentCount })}</span>
                )}
                </span>
                {message.attempt && <span className="block text-muted-foreground">{t(ATTEMPT_LABEL[message.attempt.state])}</span>}
                {held && <span className="block text-muted-foreground">{t(message.delivery === QUEUE_DELIVERY.CHANGED
                    ? 'chat.queuedMessage.targetChanged' : 'chat.queuedMessage.targetUnknown')}</span>}
            </span>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={blocked || !!message.attempt || sending}
                onClick={() => onEdit(message)}
            >
                <Icon name="edit" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.edit')}
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={held || blocked || !!message.attempt || sending}
                onClick={() => onSend(message)}
            >
                <Icon name="send-plane" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.send')}
            </Button>
            {message.attempt?.state === QUEUE_ATTEMPT.UNKNOWN && isServerOwnedMessageQueue() && (
                <Button type="button" variant="secondary" size="xs" disabled={held || sending} onClick={() => onResubmit(message)}>
                    {t('chat.queuedMessage.resubmit')}
                </Button>
            )}
            <button
                type="button"
                disabled={isQueueUnresolved(message) || sending}
                onClick={() => removeFromQueue(target, message.id)}
                className="flex items-center justify-center h-6 w-6 flex-shrink-0 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                aria-label={t('chat.queuedMessage.removeAria')}
            >
                <Icon name="close" className="h-4 w-4 text-muted-foreground" />
            </button>
        </div>
    );
});

QueuedMessageChip.displayName = 'QueuedMessageChip';

interface QueuedMessageChipsProps {
    target: MessageQueueTarget | null;
    hidden?: boolean;
    /** The message was taken from the queue in full; the composer restores it. */
    onEditMessage: (message: QueuedMessage) => void;
    onSendMessage: (messageId: string) => void;
}

const EMPTY_QUEUE: QueuedMessage[] = [];

export const QueuedMessageChips = memo(({ target, hidden = false, onEditMessage, onSendMessage }: QueuedMessageChipsProps) => {
    const { t } = useI18n();
    // One shared preference, so the list stays open (or closed) across
    // session switches instead of resetting with the queue key.
    const collapsed = !useUIStore((state) => state.messageQueueExpanded);
    const setMessageQueueExpanded = useUIStore((state) => state.setMessageQueueExpanded);
    const [confirmation, setConfirmation] = React.useState<{ target: MessageQueueTarget; itemId: string; attemptId: string } | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const resubmit = useMessageQueueStore(state => state.resubmit);
    const bodyId = React.useId();
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const queueKey = target ? getMessageQueueKey(target) : null;
    const queuedMessages = useMessageQueueStore(
        React.useCallback(
            (state) => {
                if (!queueKey) return EMPTY_QUEUE;
                return state.queuedMessages[queueKey] ?? EMPTY_QUEUE;
            },
            [queueKey]
        )
    );
    const blocked = queuedMessages.some(isQueueUnresolved);
    const popToInput = useMessageQueueStore((state) => state.popToInput);
    const reorderQueue = useMessageQueueStore((state) => state.reorderQueue);
    const availableMaxHeight = useMobileAutocompleteMaxHeight(bodyRef, !hidden && !collapsed && queuedMessages.length > 0, 168 + 48);

    const sensors = useSensors(
        // Desktop: drag after a small move so other clicks still register.
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        // Touch: long-press to drag (tap still hits buttons, swipe scrolls).
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    );

    const handleDragEnd = React.useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !target || blocked) return;
        reorderQueue(target, String(active.id), String(over.id));
    }, [target, reorderQueue, blocked]);

    const handleEdit = React.useCallback((message: QueuedMessage) => {
        if (!target || blocked || message.attempt) return;

        // The full message (attachments included) comes back from the queue's
        // owner; the chip itself only knows the summary.
        void popToInput(target, message.id).then((popped) => {
            if (!popped) return;
            if (popped.attachments && popped.attachments.length > 0) {
                const currentAttachments = useInputStore.getState().attachedFiles;
                useInputStore.getState().setAttachedFiles([...currentAttachments, ...popped.attachments]);
            }
            onEditMessage(popped);
        }).catch((error) => {
            console.warn('[queue] failed to take queued message for editing:', error);
            toast.error(t('chat.queuedMessage.toast.takeFailed'));
        });
    }, [target, popToInput, onEditMessage, t, blocked]);

    const handleSend = React.useCallback((message: QueuedMessage) => {
        if (blocked || message.attempt || message.delivery !== undefined && message.delivery !== QUEUE_DELIVERY.READY) return;
        onSendMessage(message.id);
    }, [onSendMessage, blocked]);

    const handleResubmit = (message: QueuedMessage) => {
        if (!target || message.attempt?.state !== QUEUE_ATTEMPT.UNKNOWN) return;
        setConfirmation({ target, itemId: message.id, attemptId: message.attempt.id });
    };
    const confirmedItem = confirmation && queuedMessages.find(message => message.id === confirmation.itemId);
    const confirmationCurrent = !!confirmation && getMessageQueueKey(confirmation.target) === queueKey
        && confirmedItem?.attempt?.state === QUEUE_ATTEMPT.UNKNOWN && confirmedItem.attempt.id === confirmation.attemptId;
    const confirmResubmit = async () => {
        if (!confirmation || !confirmationCurrent || submitting) return;
        const captured = confirmation;
        setSubmitting(true);
        try {
            await resubmit(captured.target, captured.itemId, captured.attemptId);
        } catch {
            toast.error(t('chat.queuedMessage.resubmitError'));
        } finally {
            setSubmitting(false);
            setConfirmation(current => current === captured ? null : current);
        }
    };

    if (hidden || queuedMessages.length === 0 || !target) {
        return null;
    }

    return (
        <>
        <ComposerFloatingPanel role="region" ariaLabel={t('chat.queuedMessage.title')} compact={collapsed} header={
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMessageQueueExpanded(collapsed)}
                    aria-expanded={!collapsed}
                    aria-controls={collapsed ? undefined : bodyId}
                    className="min-w-0 flex-1 shrink justify-start px-0 normal-case text-muted-foreground hover:!bg-transparent hover:text-foreground has-[>svg]:px-0"
                >
                    <Icon name="time" className="size-3.5 shrink-0" aria-hidden="true" />
                    <Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{t('chat.queuedMessage.title')} {queuedMessages.length}</span>
                </Button>
        }>
            {!collapsed && (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={queuedMessages.map((m) => m.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div
                            ref={bodyRef}
                            id={bodyId}
                            className="px-3 pb-3 flex flex-col gap-1.5 max-h-[10.5rem] overflow-y-auto overscroll-contain"
                            style={availableMaxHeight === undefined ? undefined : { maxHeight: Math.max(72, availableMaxHeight - 48) }}
                        >
                            {queuedMessages.map((message) => (
                                <QueuedMessageChip
                                    key={message.id}
                                    message={message}
                                    target={target}
                                    blocked={blocked}
                                    onResubmit={handleResubmit}
                                    onEdit={handleEdit}
                                    onSend={handleSend}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </ComposerFloatingPanel>
        <Dialog open={confirmationCurrent} onOpenChange={open => { if (!open && !submitting) setConfirmation(null); }}>
            <DialogContent showCloseButton={false} className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('chat.queuedMessage.resubmitTitle')}</DialogTitle>
                    <DialogDescription>{t('chat.queuedMessage.resubmitDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="ghost" disabled={submitting} onClick={() => setConfirmation(null)}>{t('chat.queuedMessage.resubmitCancel')}</Button>
                    <Button type="button" disabled={submitting} onClick={() => { void confirmResubmit(); }}>{t('chat.queuedMessage.resubmitConfirm')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
});

QueuedMessageChips.displayName = 'QueuedMessageChips';
