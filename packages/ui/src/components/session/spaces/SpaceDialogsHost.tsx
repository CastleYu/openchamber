import type React from 'react';
import { useOnDemandComponent } from '@/hooks/useOnDemandComponent';
import { useSpacesStore } from '@/lib/spaces/spaces-store';

const loadAccess = () => import('./SpaceAccessDialog').then((module) => module.SpaceAccessDialog);
const loadActions = () => import('./SpaceActions').then((module) => module.SpaceActionsSheet);
const loadDelete = () => import('./SpaceActions').then((module) => module.SpaceDeleteDialog);
const loadApply = () => import('./SpaceApplyDialog').then((module) => module.SpaceApplyDialog);
const loadSetupOutput = () => import('./SpaceSetupOutput').then((module) => module.SpaceSetupOutputDialog);

/** Load each dialog when its space action opens; keep it mounted thereafter. */
export function SpaceDialogsHost(): React.ReactNode {
  const accessOpen = useSpacesStore((state) => state.accessDialog !== null);
  const actionsOpen = useSpacesStore((state) => state.actionsSheet !== null);
  const deleteOpen = useSpacesStore((state) => state.deleteDialog !== null);
  const applyOpen = useSpacesStore((state) => state.applyDialog !== null);
  const setupOutputOpen = useSpacesStore((state) => state.setupOutputDialog !== null);

  const Access = useOnDemandComponent(accessOpen, loadAccess, () => useSpacesStore.getState().closeAccessDialog());
  const Actions = useOnDemandComponent(actionsOpen, loadActions, () => useSpacesStore.getState().closeActionsSheet());
  const Delete = useOnDemandComponent(deleteOpen, loadDelete, () => useSpacesStore.getState().closeDeleteDialog());
  const Apply = useOnDemandComponent(applyOpen, loadApply, () => useSpacesStore.getState().closeApplyDialog());
  const SetupOutput = useOnDemandComponent(setupOutputOpen, loadSetupOutput, () => useSpacesStore.getState().closeSetupOutputDialog());

  return <>
    {Access ? <Access /> : null}
    {Actions ? <Actions /> : null}
    {Delete ? <Delete /> : null}
    {Apply ? <Apply /> : null}
    {SetupOutput ? <SetupOutput /> : null}
  </>;
}
