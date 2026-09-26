import { describe, expect, spyOn, test } from "bun:test";

import { catalogRefreshTasks, refreshStoresForCatalogKind } from "./catalogRefresh";
import { opencodeClient } from '@/lib/opencode/client';
import { useWebSearchStore } from './useWebSearchStore';

describe("catalogRefreshTasks", () => {
  test('websearch events reload an opened OC2 page but make no OC1 request', async () => {
    const previous = useWebSearchStore.getState().state;
    const originalLoad = useWebSearchStore.getState().load;
    const load = spyOn(useWebSearchStore.getState(), 'load').mockResolvedValue();
    useWebSearchStore.setState({ state: { kind: 'failed', scope: 'fixture' } });
    try {
      opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://catalog.test', epoch: 1, version: '2.0.16' });
      await refreshStoresForCatalogKind('websearch');
      expect(load.mock.calls.length).toBe(1);
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://catalog.test', epoch: 2, version: '1.18.32' });
      await refreshStoresForCatalogKind('websearch');
      expect(load.mock.calls.length).toBe(1);
    } finally {
      load.mockRestore();
      useWebSearchStore.setState({ state: previous, load: originalLoad });
      opencodeClient.reconnectToRuntimeBaseUrl();
    }
  });
  test("a config rebuild re-reads every list a config file can carry", () => {
    // Agents, commands, skills, MCP servers, plugins and providers all live
    // in config, and OpenChamber's own plugin injection is one of them. So
    // does the web search choice.
    expect(catalogRefreshTasks("config")).toHaveLength(7);
  });

  test("a single-catalog rebuild re-reads only that list", () => {
    for (const kind of ["agent", "command", "skill", "plugin", "provider", "websearch"] as const) {
      expect(catalogRefreshTasks(kind)).toHaveLength(1);
    }
  });

  test("a credential change re-reads providers and web search keys", () => {
    expect(catalogRefreshTasks("credential")).toHaveLength(2);
  });

  test("projects belong to the sync stores, not to the settings lists", () => {
    expect(catalogRefreshTasks("project")).toEqual([]);
  });
});
