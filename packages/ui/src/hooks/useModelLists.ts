import React from 'react';
import { findCatalogModel } from '@/lib/opencode/model';
import { getSelectableModelId, selectProvidersForDirectory, useConfigStore, type ProviderModel, type ProviderWithModelList } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';

export interface ModelListItem {
  provider: ProviderWithModelList;
  model: ProviderModel;
  providerID: string;
  modelID: string;
}

const findProviderModel = (provider: ProviderWithModelList, modelID: string): ProviderModel | undefined =>
  provider.generation === 'oc2'
    ? findCatalogModel(provider.models, modelID)
    : provider.models.find((model) => getSelectableModelId(model) === modelID);

export const useModelLists = (directory?: string) => {
  const providers = useConfigStore((state) => directory === undefined
    ? state.providers
    : selectProvidersForDirectory(state, directory));
  const favoriteModels = useUIStore((state) => state.favoriteModels);
  const recentModels = useUIStore((state) => state.recentModels);
  const hiddenModels = useUIStore((state) => state.hiddenModels);

  const isHidden = React.useCallback((providerID: string, modelID: string) => {
    return hiddenModels.some((item) => item.providerID === providerID && item.modelID === modelID);
  }, [hiddenModels]);

  const favoriteModelsList = React.useMemo(() => {
    return favoriteModels
      .map(({ providerID, modelID }) => {
        const provider = providers.find((p) => p.id === providerID);
        if (!provider) return null;
        const model = findProviderModel(provider, modelID);
        if (!model) return null;
        if (isHidden(providerID, modelID)) return null;
        return { provider, model, providerID, modelID };
      })
      .filter((item): item is ModelListItem => item !== null);
  }, [favoriteModels, providers, isHidden]);

  const recentModelsList = React.useMemo(() => {
    return recentModels
      .map(({ providerID, modelID }) => {
        const provider = providers.find((p) => p.id === providerID);
        if (!provider) return null;
        const model = findProviderModel(provider, modelID);
        if (!model) return null;
        if (isHidden(providerID, modelID)) return null;
        return { provider, model, providerID, modelID };
      })
      .filter((item): item is ModelListItem => item !== null)
      .filter(({ providerID, modelID }) =>
        !favoriteModels.some(fav => fav.providerID === providerID && fav.modelID === modelID)
      );
  }, [recentModels, providers, favoriteModels, isHidden]);

  return { favoriteModelsList, recentModelsList };
};
